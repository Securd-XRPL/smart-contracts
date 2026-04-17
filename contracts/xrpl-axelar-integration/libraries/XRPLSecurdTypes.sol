// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library XRPLSecurdTypes {
    enum ActionType {
        SUPPLY,
        BORROW,
        REPAY,
        WITHDRAW
    }

    struct IntentEnvelope {
        bytes32 intentId;
        bytes32 xrplAccount;
        address market;
        address underlying;
        uint8 actionType;
        uint256 amount;
        uint64 nonce;
        uint64 deadline;
        bytes destinationAddress;
        uint16 version;
    }

    struct SignedIntent {
        IntentEnvelope envelope;
        bytes signature;
    }
}
