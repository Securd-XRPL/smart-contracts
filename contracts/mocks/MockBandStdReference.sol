// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockBandStdReference {
    struct ReferenceData {
        uint256 rate;
        uint256 lastUpdatedBase;
        uint256 lastUpdatedQuote;
    }

    ReferenceData public data;

    function setReferenceData(uint256 rate_, uint256 lastUpdatedBase_, uint256 lastUpdatedQuote_) external {
        data = ReferenceData({rate: rate_, lastUpdatedBase: lastUpdatedBase_, lastUpdatedQuote: lastUpdatedQuote_});
    }

    function getReferenceData(string calldata, string calldata) external view returns (ReferenceData memory) {
        return data;
    }
}
