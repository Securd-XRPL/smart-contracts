// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {XRPLUserProxyFactory} from "./XRPLUserProxyFactory.sol";
import {IAxelarGateway} from "@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGateway.sol";
import {IInterchainTokenService} from
    "@axelar-network/interchain-token-service/contracts/interfaces/IInterchainTokenService.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CErc20Interface} from "../core/CTokenInterfaces.sol";
import {XRPLSecurdTypes} from "./libraries/XRPLSecurdTypes.sol";

interface ICTokenComptroller {
    function comptroller() external view returns (address);
}

/// @notice Securd V2 cross-chain adapter for XRPL Ledger <-> XRPL EVM through Axelar.
/// @dev Keeps Securd core unchanged by executing only public cToken methods through per-user proxies.
contract XRPLSecurdBridgeAdapter is Ownable, Pausable {
    error InvalidGateway();
    error InvalidIts();
    error InvalidProxyFactory();
    error NotGateway();
    error NotInterchainTokenService();
    error NotApprovedByGateway();
    error UntrustedSource(bytes32 sourceId);
    error UnsupportedVersion(uint16 provided, uint16 expected);
    error InvalidIntentId();
    error InvalidXrplAccount();
    error InvalidMarket();
    error InvalidUnderlying();
    error InvalidActionType(uint8 provided);
    error InvalidAmount();
    error InvalidDestinationAddress();
    error InvalidNonce(uint64 provided, uint64 expected);
    error DeadlineExpired(uint64 deadline, uint256 nowTs);
    error IntentHashConflict(bytes32 intentId);
    error UnsupportedIngressPath(uint8 actionType, bool tokenFlow);
    error MarketNotListed(address market);
    error TokenMismatch(address expected, address provided);
    error TokenIdMismatch(bytes32 expected, bytes32 provided);
    error AmountMismatch(uint256 expected, uint256 provided);
    error SecurdCallFailed(uint8 actionType, uint256 errorCode);
    error TransferFailed();
    error ProxyCallFailed(address target);
    error ProxyTokenCallFailed();
    error IntentSignerNotConfigured(bytes32 xrplAccount);
    error InvalidIntentSigner();
    error InvalidIntentSignature(bytes32 xrplAccount, address expected, address recovered);

    event TrustedGmpSourceSet(bytes32 indexed sourceId, string sourceChain, string sourceAddress, bool trusted);
    event TrustedItsSourceSet(bytes32 indexed sourceId, string sourceChain, bytes sourceAddress, bool trusted);
    event MarketConfigured(address indexed market, address indexed underlying, bytes32 indexed tokenId, bool listed);
    event DestinationChainSet(string previous, string current);
    event EgressGasValueSet(uint256 previous, uint256 current);
    event IntentSignerSet(bytes32 indexed xrplAccount, address indexed previousSigner, address indexed newSigner);
    event NonceReset(bytes32 indexed xrplAccount, uint64 previousNonce, uint64 newNonce);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);
    event IntentDuplicateIgnored(bytes32 indexed intentId, bytes32 payloadHash);
    event IntentExecuted(
        bytes32 indexed intentId,
        bytes32 indexed xrplAccount,
        address indexed proxy,
        uint8 actionType,
        address market,
        address underlying,
        uint256 amount,
        bool tokenFlow
    );
    event EgressInitiated(
        bytes32 indexed intentId,
        bytes32 indexed xrplAccount,
        bytes32 indexed tokenId,
        string destinationChain,
        bytes destinationAddress,
        uint256 amount,
        uint256 gasValue
    );

    uint16 public constant ENVELOPE_VERSION = 1;
    bytes32 public constant ITS_EXECUTE_SUCCESS = keccak256("its-execute-success");

    struct MarketConfig {
        address underlying;
        bytes32 tokenId;
        bool listed;
    }

    IAxelarGateway public immutable gateway;
    IInterchainTokenService public immutable interchainTokenService;
    XRPLUserProxyFactory public immutable proxyFactory;

    // Source allowlists.
    mapping(bytes32 => bool) public trustedGmpSource;
    mapping(bytes32 => bool) public trustedItsSource;

    // Cross-chain replay and ordering controls.
    mapping(bytes32 => bytes32) public payloadHashByIntent;
    mapping(bytes32 => uint64) public nextNonceByXrplAccount;
    mapping(bytes32 => address) public intentSignerOfXrplAccount;

    // Securd market registry.
    mapping(address => MarketConfig) public marketConfigOf;

    string public destinationChain;
    uint256 public egressGasValue;

    /// @param initialOwner Address that receives administrative control over bridge configuration.
    /// @param gateway_ Axelar gateway used for GMP validation.
    /// @param interchainTokenService_ Axelar Interchain Token Service used for token ingress/egress.
    /// @param proxyFactory_ Factory that manages deterministic per-user proxy accounts.
    /// @param destinationChain_ Axelar destination-chain identifier used for outbound transfers.
    constructor(
        address initialOwner,
        address gateway_,
        address interchainTokenService_,
        address proxyFactory_,
        string memory destinationChain_
    ) {
        require(initialOwner != address(0), "owner=0");
        if (initialOwner != msg.sender) {
            _transferOwnership(initialOwner);
        }
        if (gateway_ == address(0)) revert InvalidGateway();
        if (interchainTokenService_ == address(0)) revert InvalidIts();
        if (proxyFactory_ == address(0)) revert InvalidProxyFactory();

        gateway = IAxelarGateway(gateway_);
        interchainTokenService = IInterchainTokenService(interchainTokenService_);
        proxyFactory = XRPLUserProxyFactory(proxyFactory_);
        destinationChain = destinationChain_;
    }

    // ========= Owner configuration =========

    /// @notice Trusts or distrusts a specific Axelar GMP source contract.
    function setTrustedGmpSource(string calldata sourceChain, string calldata sourceAddress, bool trusted)
        external
        onlyOwner
    {
        bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
        trustedGmpSource[sourceId] = trusted;
        emit TrustedGmpSourceSet(sourceId, sourceChain, sourceAddress, trusted);
    }

    /// @notice Trusts or distrusts a specific ITS source address.
    function setTrustedItsSource(string calldata sourceChain, bytes calldata sourceAddress, bool trusted)
        external
        onlyOwner
    {
        bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
        trustedItsSource[sourceId] = trusted;
        emit TrustedItsSourceSet(sourceId, sourceChain, sourceAddress, trusted);
    }

    /// @notice Lists or updates a supported lending market for bridge execution.
    /// @param market cToken market address executed on XRPL EVM.
    /// @param underlying Underlying ERC20 asset used by the market.
    /// @param tokenId Axelar ITS token identifier for the underlying asset.
    /// @param listed Whether the market is available for cross-chain actions.
    function setMarket(address market, address underlying, bytes32 tokenId, bool listed) external onlyOwner {
        if (market == address(0)) revert InvalidMarket();
        if (underlying == address(0)) revert InvalidUnderlying();

        marketConfigOf[market] = MarketConfig({underlying: underlying, tokenId: tokenId, listed: listed});
        emit MarketConfigured(market, underlying, tokenId, listed);
    }

    /// @notice Updates the Axelar destination-chain identifier for outbound transfers.
    function setDestinationChain(string calldata newDestinationChain) external onlyOwner {
        string memory prev = destinationChain;
        destinationChain = newDestinationChain;
        emit DestinationChainSet(prev, newDestinationChain);
    }

    /// @notice Updates the native gas amount forwarded to outbound ITS transfers.
    function setEgressGasValue(uint256 newEgressGasValue) external onlyOwner {
        uint256 prev = egressGasValue;
        egressGasValue = newEgressGasValue;
        emit EgressGasValueSet(prev, newEgressGasValue);
    }

    /// @notice Sets the authorized offchain signer for an XRPL account's intents.
    /// @dev This adds per-user cryptographic authorization on top of Axelar source validation.
    function setIntentSigner(bytes32 xrplAccount, address signer) external onlyOwner {
        if (xrplAccount == bytes32(0)) revert InvalidXrplAccount();
        if (signer == address(0)) revert InvalidIntentSigner();
        address previousSigner = intentSignerOfXrplAccount[xrplAccount];
        intentSignerOfXrplAccount[xrplAccount] = signer;
        emit IntentSignerSet(xrplAccount, previousSigner, signer);
    }

    /// @notice Emergency nonce override for an XRPL account.
    /// @dev Only use when an intentId conflict has permanently deadlocked a user's nonce sequence.
    ///      Emits NonceReset so the advance is auditable on-chain.
    function resetNonce(bytes32 xrplAccount, uint64 newNonce) external onlyOwner {
        if (xrplAccount == bytes32(0)) revert InvalidXrplAccount();
        uint64 prev = nextNonceByXrplAccount[xrplAccount];
        nextNonceByXrplAccount[xrplAccount] = newNonce;
        emit NonceReset(xrplAccount, prev, newNonce);
    }

    /// @notice Recovers ERC20 tokens that became stuck in the adapter.
    /// @dev Needed for C-1: when an ITS duplicate arrives, tokens are already in the adapter
    ///      before executeWithInterchainToken runs; the duplicate-ignore path leaves them here.
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert TransferFailed();
        _safeTransfer(token, to, amount);
        emit TokenRescued(token, to, amount);
    }

    /// @notice Withdraws native gas funds accumulated in the adapter.
    function withdrawNative(address payable to, uint256 amount) external onlyOwner {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Pauses all bridge ingress execution.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses all bridge ingress execution.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ========= Axelar ingress =========

    /// @notice Handles control intents (borrow/withdraw) from Axelar GMP.
    /// @dev The payload must encode `XRPLSecurdTypes.SignedIntent`.
    function execute(bytes32 commandId, string calldata sourceChain, string calldata sourceAddress, bytes calldata payload)
        external
        whenNotPaused
    {
        if (msg.sender != address(gateway)) revert NotGateway();

        bytes32 gatewayPayloadHash = keccak256(payload);
        if (!gateway.validateContractCall(commandId, sourceChain, sourceAddress, gatewayPayloadHash)) {
            revert NotApprovedByGateway();
        }

        bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
        if (!trustedGmpSource[sourceId]) revert UntrustedSource(sourceId);

        XRPLSecurdTypes.SignedIntent memory signedIntent = abi.decode(payload, (XRPLSecurdTypes.SignedIntent));
        XRPLSecurdTypes.IntentEnvelope memory envelope = signedIntent.envelope;
        bytes32 payloadHash = _hashEnvelope(envelope);
        _validateEnvelopeBase(envelope);
        _validateIntentSignature(envelope.xrplAccount, payloadHash, signedIntent.signature);

        if (
            envelope.actionType != uint8(XRPLSecurdTypes.ActionType.BORROW)
                && envelope.actionType != uint8(XRPLSecurdTypes.ActionType.WITHDRAW)
        ) {
            revert UnsupportedIngressPath(envelope.actionType, false);
        }

        if (!_lockIntent(envelope.intentId, payloadHash)) {
            emit IntentDuplicateIgnored(envelope.intentId, payloadHash);
            return;
        }

        _validateNonce(envelope.xrplAccount, envelope.nonce);
        address proxy = _prepareExecution(envelope);

        if (envelope.actionType == uint8(XRPLSecurdTypes.ActionType.BORROW)) {
            _borrow(proxy, envelope.market, envelope.amount);
        } else {
            _withdraw(proxy, envelope.market, envelope.amount);
        }

        // Consume nonce before egress so a re-entrant ITS callback cannot replay the same intent.
        _consumeNonce(envelope.xrplAccount);
        _egress(proxy, envelope);

        emit IntentExecuted(
            envelope.intentId,
            envelope.xrplAccount,
            proxy,
            envelope.actionType,
            envelope.market,
            envelope.underlying,
            envelope.amount,
            false
        );
    }

    /// @notice Handles value intents (supply/repay) from ITS token callback.
    /// @dev The `data` field must encode `XRPLSecurdTypes.SignedIntent`.
    function executeWithInterchainToken(
        bytes32 commandId,
        string calldata sourceChain,
        bytes calldata sourceAddress,
        bytes calldata data,
        bytes32 tokenId,
        address token,
        uint256 amount
    ) external whenNotPaused returns (bytes32) {
        commandId; // command id is consumed by ITS/gateway; intent hash provides idempotency at app layer.
        if (msg.sender != address(interchainTokenService)) revert NotInterchainTokenService();

        bytes32 sourceId = keccak256(abi.encode(sourceChain, sourceAddress));
        if (!trustedItsSource[sourceId]) revert UntrustedSource(sourceId);

        XRPLSecurdTypes.SignedIntent memory signedIntent = abi.decode(data, (XRPLSecurdTypes.SignedIntent));
        XRPLSecurdTypes.IntentEnvelope memory envelope = signedIntent.envelope;
        bytes32 payloadHash = _hashEnvelope(envelope);
        _validateEnvelopeBase(envelope);
        _validateIntentSignature(envelope.xrplAccount, payloadHash, signedIntent.signature);

        if (
            envelope.actionType != uint8(XRPLSecurdTypes.ActionType.SUPPLY)
                && envelope.actionType != uint8(XRPLSecurdTypes.ActionType.REPAY)
        ) {
            revert UnsupportedIngressPath(envelope.actionType, true);
        }

        MarketConfig memory cfg = _requireMarket(envelope.market);
        if (cfg.underlying != token) revert TokenMismatch(cfg.underlying, token);
        if (cfg.tokenId != tokenId) revert TokenIdMismatch(cfg.tokenId, tokenId);
        if (envelope.amount != amount) revert AmountMismatch(envelope.amount, amount);

        if (!_lockIntent(envelope.intentId, payloadHash)) {
            emit IntentDuplicateIgnored(envelope.intentId, payloadHash);
            return ITS_EXECUTE_SUCCESS;
        }

        _validateNonce(envelope.xrplAccount, envelope.nonce);
        address proxy = _prepareExecution(envelope);

        if (envelope.actionType == uint8(XRPLSecurdTypes.ActionType.SUPPLY)) {
            _supply(proxy, envelope.market, envelope.underlying, amount);
        } else {
            _repay(proxy, envelope.market, envelope.underlying, amount);
        }

        _consumeNonce(envelope.xrplAccount);

        emit IntentExecuted(
            envelope.intentId,
            envelope.xrplAccount,
            proxy,
            envelope.actionType,
            envelope.market,
            envelope.underlying,
            amount,
            true
        );

        return ITS_EXECUTE_SUCCESS;
    }

    // ========= Internal execution =========

    function _validateEnvelopeBase(XRPLSecurdTypes.IntentEnvelope memory envelope) internal view {
        if (envelope.version != ENVELOPE_VERSION) revert UnsupportedVersion(envelope.version, ENVELOPE_VERSION);
        if (envelope.intentId == bytes32(0)) revert InvalidIntentId();
        if (envelope.xrplAccount == bytes32(0)) revert InvalidXrplAccount();
        if (envelope.market == address(0)) revert InvalidMarket();
        if (envelope.underlying == address(0)) revert InvalidUnderlying();
        if (envelope.amount == 0) revert InvalidAmount();
        if (envelope.actionType > uint8(XRPLSecurdTypes.ActionType.WITHDRAW)) {
            revert InvalidActionType(envelope.actionType);
        }
        if (envelope.deadline != 0 && block.timestamp > envelope.deadline) {
            revert DeadlineExpired(envelope.deadline, block.timestamp);
        }

        MarketConfig memory cfg = _requireMarket(envelope.market);
        if (cfg.underlying != envelope.underlying) revert TokenMismatch(cfg.underlying, envelope.underlying);
    }

    function _validateNonce(bytes32 xrplAccount, uint64 nonce) internal view {
        uint64 next = nextNonceByXrplAccount[xrplAccount];
        if (nonce != next) revert InvalidNonce(nonce, next);
    }

    function _validateIntentSignature(bytes32 xrplAccount, bytes32 payloadHash, bytes memory signature) internal view {
        address expectedSigner = intentSignerOfXrplAccount[xrplAccount];
        if (expectedSigner == address(0)) revert IntentSignerNotConfigured(xrplAccount);

        bytes32 digest = keccak256(abi.encode(address(this), block.chainid, payloadHash));
        bytes32 ethSignedDigest = ECDSA.toEthSignedMessageHash(digest);
        address recoveredSigner = ECDSA.recover(ethSignedDigest, signature);
        if (recoveredSigner != expectedSigner) {
            revert InvalidIntentSignature(xrplAccount, expectedSigner, recoveredSigner);
        }
    }

    function _hashEnvelope(XRPLSecurdTypes.IntentEnvelope memory envelope) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                envelope.intentId,
                envelope.xrplAccount,
                envelope.market,
                envelope.underlying,
                envelope.actionType,
                envelope.amount,
                envelope.nonce,
                envelope.deadline,
                envelope.destinationAddress,
                envelope.version
            )
        );
    }

    function _prepareExecution(XRPLSecurdTypes.IntentEnvelope memory envelope) internal returns (address proxy) {
        proxy = proxyFactory.getOrCreateProxy(envelope.xrplAccount);
    }

    function _consumeNonce(bytes32 xrplAccount) internal {
        nextNonceByXrplAccount[xrplAccount] += 1;
    }

    function _lockIntent(bytes32 intentId, bytes32 payloadHash) internal returns (bool created) {
        bytes32 seen = payloadHashByIntent[intentId];
        if (seen == bytes32(0)) {
            payloadHashByIntent[intentId] = payloadHash;
            return true;
        }
        if (seen == payloadHash) return false;
        revert IntentHashConflict(intentId);
    }

    function _requireMarket(address market) internal view returns (MarketConfig memory cfg) {
        cfg = marketConfigOf[market];
        if (!cfg.listed) revert MarketNotListed(market);
    }

    function _supply(address proxy, address market, address underlying, uint256 amount) internal {
        _safeTransfer(underlying, proxy, amount);

        _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, uint256(0)));
        _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, amount));

        // Use raw (non-reverting) proxy call so we can always reset the allowance — even if mint reverts.
        // A revert without the reset would leave an open approval on the proxy for a potentially untrusted market.
        (bool mintOk, bytes memory mintOut) = _proxyCallRaw(proxy, market, abi.encodeWithSelector(CErc20Interface.mint.selector, amount));

        // Reset allowance unconditionally — guards against stale approval on both success and failure paths.
        _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, uint256(0)));

        if (!mintOk) {
            if (mintOut.length == 0) revert ProxyCallFailed(market);
            assembly { revert(add(mintOut, 0x20), mload(mintOut)) }
        }
        _requireSecurdSuccess(uint8(XRPLSecurdTypes.ActionType.SUPPLY), mintOut);

        // Enter the supplied market so the cToken balance counts as collateral in liquidity checks.
        // Without this call, cross-asset borrowing always fails with INSUFFICIENT_LIQUIDITY because
        // Compound's getHypotheticalAccountLiquidityInternal only iterates accountAssets[proxy].
        address comptrollerAddr = ICTokenComptroller(market).comptroller();
        address[] memory marketsToEnter = new address[](1);
        marketsToEnter[0] = market;
        _proxyCall(proxy, comptrollerAddr, abi.encodeWithSignature("enterMarkets(address[])", marketsToEnter));
    }

    function _repay(address proxy, address market, address underlying, uint256 amount) internal {
        _safeTransfer(underlying, proxy, amount);

        _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, uint256(0)));
        _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, amount));

        // Use raw (non-reverting) proxy call so we can always reset the allowance — even if repayBorrow reverts.
        (bool repayOk, bytes memory repayOut) =
            _proxyCallRaw(proxy, market, abi.encodeWithSelector(CErc20Interface.repayBorrow.selector, amount));

        // Reset allowance unconditionally — mirrors the _supply pattern; prevents stale approval on failure paths.
        _proxyTokenCall(proxy, underlying, abi.encodeWithSelector(IERC20.approve.selector, market, uint256(0)));

        if (!repayOk) {
            if (repayOut.length == 0) revert ProxyCallFailed(market);
            assembly { revert(add(repayOut, 0x20), mload(repayOut)) }
        }
        _requireSecurdSuccess(uint8(XRPLSecurdTypes.ActionType.REPAY), repayOut);
    }

    function _borrow(address proxy, address market, uint256 amount) internal {
        bytes memory out = _proxyCall(proxy, market, abi.encodeWithSelector(CErc20Interface.borrow.selector, amount));
        _requireSecurdSuccess(uint8(XRPLSecurdTypes.ActionType.BORROW), out);
    }

    function _withdraw(address proxy, address market, uint256 amount) internal {
        bytes memory out =
            _proxyCall(proxy, market, abi.encodeWithSelector(CErc20Interface.redeemUnderlying.selector, amount));
        _requireSecurdSuccess(uint8(XRPLSecurdTypes.ActionType.WITHDRAW), out);
    }

    function _egress(address proxy, XRPLSecurdTypes.IntentEnvelope memory envelope) internal {
        if (envelope.destinationAddress.length == 0 || envelope.destinationAddress.length > 256)
            revert InvalidDestinationAddress();

        MarketConfig memory cfg = _requireMarket(envelope.market);
        bytes memory pullData = abi.encodeWithSelector(IERC20.transfer.selector, address(this), envelope.amount);
        _proxyTokenCall(proxy, envelope.underlying, pullData);

        _safeApprove(envelope.underlying, address(interchainTokenService), 0);
        _safeApprove(envelope.underlying, address(interchainTokenService), envelope.amount);

        interchainTokenService.interchainTransfer{value: egressGasValue}(
            cfg.tokenId,
            destinationChain,
            envelope.destinationAddress,
            envelope.amount,
            bytes(""),
            egressGasValue
        );

        emit EgressInitiated(
            envelope.intentId,
            envelope.xrplAccount,
            cfg.tokenId,
            destinationChain,
            envelope.destinationAddress,
            envelope.amount,
            egressGasValue
        );
    }

    function _proxyCall(address proxy, address target, bytes memory data) internal returns (bytes memory) {
        (bool ok, bytes memory out) = proxy.call(
            abi.encodeWithSignature("execute(address,uint256,bytes)", target, uint256(0), data)
        );
        if (!ok) {
            if (out.length == 0) revert ProxyCallFailed(target);
            assembly {
                revert(add(out, 0x20), mload(out))
            }
        }
        return abi.decode(out, (bytes));
    }

    /// @dev Like _proxyCall but never reverts — returns (ok, innerReturnData) for callers that need
    ///      to perform cleanup (e.g. allowance reset) regardless of whether the inner call succeeded.
    function _proxyCallRaw(address proxy, address target, bytes memory data) internal returns (bool ok, bytes memory innerOut) {
        bytes memory out;
        (ok, out) = proxy.call(
            abi.encodeWithSignature("execute(address,uint256,bytes)", target, uint256(0), data)
        );
        if (ok) {
            innerOut = abi.decode(out, (bytes));
        } else {
            innerOut = out;
        }
    }

    function _proxyTokenCall(address proxy, address token, bytes memory data) internal {
        bytes memory out = _proxyCall(proxy, token, data);
        if (out.length == 0) return;
        if (out.length == 32 && abi.decode(out, (bool))) return;
        revert ProxyTokenCallFailed();
    }

    function _requireSecurdSuccess(uint8 actionType, bytes memory out) internal pure {
        uint256 code = 1;
        if (out.length == 32) code = abi.decode(out, (uint256));
        if (code != 0) revert SecurdCallFailed(actionType, code);
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok) revert TransferFailed();
        if (data.length > 0 && !abi.decode(data, (bool))) revert TransferFailed();
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        if (!ok) revert TransferFailed();
        if (data.length > 0 && !abi.decode(data, (bool))) revert TransferFailed();
    }

    receive() external payable {}
}
