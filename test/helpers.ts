import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

export enum ActionType {
  SUPPLY = 0,
  BORROW = 1,
  REPAY = 2,
  WITHDRAW = 3
}

export type IntentEnvelope = {
  intentId: string;
  xrplAccount: string;
  market: string;
  underlying: string;
  actionType: number;
  amount: bigint;
  nonce: number;
  deadline: number;
  destinationAddress: string;
  version: number;
};

export async function signIntent(
  adapterAddress: string,
  signer: SignerWithAddress,
  envelope: IntentEnvelope
) {
  const network = await ethers.provider.getNetwork();
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "bytes32",
      "bytes32",
      "address",
      "address",
      "uint8",
      "uint256",
      "uint64",
      "uint64",
      "bytes",
      "uint16"
    ],
    [
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
    ]
  );

  const payloadHash = ethers.keccak256(encoded);
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256", "bytes32"], [adapterAddress, network.chainId, payloadHash])
  );
  const signature = await signer.signMessage(ethers.getBytes(digest));

  return {
    envelope: {
      intentId: envelope.intentId,
      xrplAccount: envelope.xrplAccount,
      market: envelope.market,
      underlying: envelope.underlying,
      actionType: envelope.actionType,
      amount: envelope.amount,
      nonce: envelope.nonce,
      deadline: envelope.deadline,
      destinationAddress: envelope.destinationAddress,
      version: envelope.version
    },
    signature
  };
}

export function randomIntentId(tag: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(tag));
}
