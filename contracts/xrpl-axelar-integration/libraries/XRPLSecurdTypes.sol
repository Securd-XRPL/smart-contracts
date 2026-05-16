// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library XRPLSecurdTypes {
    enum ActionType {
        SUPPLY,       // 0 — ITS interchain_transfer inbound, mint cTokens
        BORROW,       // 1 — GMP call_contract, borrow + ITS egress
        REPAY,        // 2 — ITS interchain_transfer inbound, repay debt
        WITHDRAW,     // 3 — GMP call_contract, redeem + ITS egress
        ENTER_MARKET, // 4 — GMP call_contract, enter collateral market (no egress)
        EXIT_MARKET   // 5 — GMP call_contract, exit collateral market (no egress)
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
