// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {XRPLUserProxy} from "./XRPLUserProxy.sol";

/// @title XRPLUserProxyFactory
/// @notice Deterministically deploys one execution proxy per XRPL account.
/// @dev The configured controller is the bridge adapter that orchestrates user actions on XRPL EVM.
contract XRPLUserProxyFactory is Ownable {
    error NotController();
    error ControllerFrozen();

    event ControllerSet(address indexed previousController, address indexed newController);
    event ProxyCreated(bytes32 indexed xrplAccount, address indexed proxy);

    mapping(bytes32 => address) public proxyOf;
    address public controller;
    uint256 public proxyCount;

    /// @param initialOwner Address that receives Ownable admin rights.
    /// @param initialController Bridge adapter allowed to create and operate user proxies.
    constructor(address initialOwner, address initialController) {
        require(initialOwner != address(0), "owner=0");
        if (initialOwner != msg.sender) {
            _transferOwnership(initialOwner);
        }
        require(initialController != address(0), "controller=0");
        controller = initialController;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    /// @notice Updates the factory controller before any proxies have been deployed.
    /// @dev Freezing controller rotation after first deployment prevents old proxies from becoming unusable.
    function setController(address newController) external onlyOwner {
        if (proxyCount != 0) revert ControllerFrozen();
        require(newController != address(0), "controller=0");
        address old = controller;
        controller = newController;
        emit ControllerSet(old, newController);
    }

    /// @notice Returns the proxy for `xrplAccount`, deploying it if needed.
    /// @param xrplAccount Canonical XRPL account identifier used by the bridge layer.
    /// @return proxy Deterministic execution wallet assigned to the XRPL account.
    function getOrCreateProxy(bytes32 xrplAccount) external onlyController returns (address proxy) {
        proxy = proxyOf[xrplAccount];
        if (proxy != address(0)) return proxy;

        bytes32 salt = keccak256(abi.encodePacked(xrplAccount));
        proxy = address(new XRPLUserProxy{salt: salt}(controller, xrplAccount));
        proxyOf[xrplAccount] = proxy;
        proxyCount += 1;

        emit ProxyCreated(xrplAccount, proxy);
    }

    /// @notice Predicts the CREATE2 address for the proxy assigned to `xrplAccount`.
    /// @param xrplAccount Canonical XRPL account identifier used by the bridge layer.
    /// @return predicted Predicted proxy address for the XRPL account.
    function predictProxy(bytes32 xrplAccount) external view returns (address predicted) {
        bytes32 salt = keccak256(abi.encodePacked(xrplAccount));
        bytes memory initCode = abi.encodePacked(type(XRPLUserProxy).creationCode, abi.encode(controller, xrplAccount));

        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(initCode)));
        predicted = address(uint160(uint256(hash)));
    }
}
