// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

interface ISecurdFallbackOracle {
    function postFallbackPrice(address asset, uint256 priceMantissa) external;
}

/// @title SecurdMedianOracleReporter
/// @notice Thin reporter aggregation layer that computes a median price before forwarding it to the fallback oracle.
/// @dev This contract is intended to be granted `setAssetOracle(asset, reporter, true)` rights in `SecurdPriceOracle`.
contract SecurdMedianOracleReporter is Ownable, Pausable {
    struct AssetConfig {
        uint64 roundDuration;
        uint8 minSubmissions;
    }

    struct RoundState {
        uint64 deadline;
        bool finalized;
        uint32 submissionCount;
    }

    error InvalidOracle();
    error InvalidAsset();
    error InvalidReporter();
    error InvalidRound();
    error InvalidSubmission();
    error RoundAlreadyFinalized();
    error RoundStillOpen();
    error RoundExpired();
    error ReporterNotAuthorized(address asset, address reporter);
    error DuplicateSubmission(address asset, uint256 roundId, address reporter);
    error InsufficientSubmissions(address asset, uint256 roundId, uint256 have, uint256 need);

    event ReporterSet(address indexed asset, address indexed reporter, bool allowed);
    event AssetConfigSet(address indexed asset, uint64 roundDuration, uint8 minSubmissions);
    event PriceSubmitted(address indexed asset, uint256 indexed roundId, address indexed reporter, uint256 priceMantissa);
    event RoundPosted(address indexed asset, uint256 indexed roundId, uint256 medianPriceMantissa, uint256 submissions);
    event RoundCancelled(address indexed asset, uint256 indexed roundId);

    /// @notice Maximum number of price submissions accepted per round.
    /// @dev Caps the O(n²) insertion-sort cost in _median to a bounded, safe gas limit.
    uint8 public constant MAX_SUBMISSIONS_PER_ROUND = 50;

    ISecurdFallbackOracle public immutable fallbackOracle;

    mapping(address => AssetConfig) public assetConfig;
    mapping(address => mapping(address => bool)) public isReporterForAsset;
    mapping(address => mapping(uint256 => RoundState)) public roundStateOf;
    mapping(address => mapping(uint256 => mapping(address => uint256))) public submittedPriceOf;
    mapping(address => mapping(uint256 => uint256[])) private _roundPrices;

    constructor(address initialOwner, address fallbackOracle_) {
        if (initialOwner == address(0)) revert InvalidReporter();
        if (fallbackOracle_ == address(0)) revert InvalidOracle();

        fallbackOracle = ISecurdFallbackOracle(fallbackOracle_);
        if (initialOwner != msg.sender) {
            _transferOwnership(initialOwner);
        }
    }

    modifier onlyReporter(address asset) {
        if (!isReporterForAsset[asset][msg.sender] && msg.sender != owner()) {
            revert ReporterNotAuthorized(asset, msg.sender);
        }
        _;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Cancels a stuck round, preventing it from blocking future submissions.
    /// @dev Marks the round finalized without posting a price. Use when a round cannot reach quorum
    ///      (e.g., a reporter submitted an invalid price that the others refuse to match).
    function cancelRound(address asset, uint256 roundId) external onlyOwner {
        if (asset == address(0)) revert InvalidAsset();
        if (roundId == 0) revert InvalidRound();

        RoundState storage round = roundStateOf[asset][roundId];
        if (round.finalized) revert RoundAlreadyFinalized();

        round.finalized = true;
        emit RoundCancelled(asset, roundId);
    }

    function setReporter(address asset, address reporter, bool allowed) external onlyOwner {
        if (asset == address(0)) revert InvalidAsset();
        if (reporter == address(0)) revert InvalidReporter();

        isReporterForAsset[asset][reporter] = allowed;
        emit ReporterSet(asset, reporter, allowed);
    }

    function setAssetConfig(address asset, uint64 roundDuration, uint8 minSubmissions) external onlyOwner {
        if (asset == address(0)) revert InvalidAsset();
        if (roundDuration == 0 || minSubmissions == 0) revert InvalidSubmission();

        assetConfig[asset] = AssetConfig({roundDuration: roundDuration, minSubmissions: minSubmissions});
        emit AssetConfigSet(asset, roundDuration, minSubmissions);
    }

    function submitPrice(address asset, uint256 roundId, uint256 priceMantissa) external whenNotPaused onlyReporter(asset) {
        if (asset == address(0)) revert InvalidAsset();
        if (roundId == 0) revert InvalidRound();
        if (priceMantissa == 0) revert InvalidSubmission();

        AssetConfig memory cfg = assetConfig[asset];
        if (cfg.roundDuration == 0 || cfg.minSubmissions == 0) revert InvalidSubmission();

        RoundState storage round = roundStateOf[asset][roundId];
        if (round.finalized) revert RoundAlreadyFinalized();

        if (round.deadline == 0) {
            round.deadline = uint64(block.timestamp + cfg.roundDuration);
        } else if (block.timestamp > round.deadline) {
            revert RoundExpired();
        }

        if (submittedPriceOf[asset][roundId][msg.sender] != 0) {
            revert DuplicateSubmission(asset, roundId, msg.sender);
        }

        if (_roundPrices[asset][roundId].length >= MAX_SUBMISSIONS_PER_ROUND) revert InvalidSubmission();

        submittedPriceOf[asset][roundId][msg.sender] = priceMantissa;
        round.submissionCount += 1;
        _roundPrices[asset][roundId].push(priceMantissa);

        emit PriceSubmitted(asset, roundId, msg.sender, priceMantissa);
    }

    function finalizeRound(address asset, uint256 roundId) external whenNotPaused {
        if (asset == address(0)) revert InvalidAsset();
        if (roundId == 0) revert InvalidRound();

        AssetConfig memory cfg = assetConfig[asset];
        RoundState storage round = roundStateOf[asset][roundId];
        if (round.finalized) revert RoundAlreadyFinalized();
        if (round.deadline == 0 || block.timestamp <= round.deadline) revert RoundStillOpen();
        if (round.submissionCount < cfg.minSubmissions) {
            revert InsufficientSubmissions(asset, roundId, round.submissionCount, cfg.minSubmissions);
        }

        uint256[] memory prices = _roundPrices[asset][roundId];
        uint256 medianPrice = _median(prices);

        round.finalized = true;
        fallbackOracle.postFallbackPrice(asset, medianPrice);

        emit RoundPosted(asset, roundId, medianPrice, round.submissionCount);
    }

    function getRoundPrices(address asset, uint256 roundId) external view returns (uint256[] memory) {
        return _roundPrices[asset][roundId];
    }

    function _median(uint256[] memory values) internal pure returns (uint256) {
        uint256 length = values.length;
        for (uint256 i = 1; i < length; i++) {
            uint256 current = values[i];
            uint256 j = i;
            while (j > 0 && values[j - 1] > current) {
                values[j] = values[j - 1];
                j--;
            }
            values[j] = current;
        }

        uint256 mid = length / 2;
        if (length % 2 == 1) {
            return values[mid];
        }
        // Overflow-safe average: values are sorted ascending so values[mid] >= values[mid-1].
        uint256 lo = values[mid - 1];
        uint256 hi = values[mid];
        return lo + (hi - lo) / 2;
    }
}
