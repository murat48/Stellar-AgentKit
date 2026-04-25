import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair } from "stellar-sdk";
import { stellarSendPaymentTool } from "../../../tools/stellar";

const mockLoadAccount = vi.fn();
const mockSubmitTransaction = vi.fn();

vi.mock("stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stellar-sdk")>();
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: vi.fn().mockImplementation(function () {
        return {
          loadAccount: mockLoadAccount,
          submitTransaction: mockSubmitTransaction,
        };
      }),
    },
  };
});

describe("stellarSendPaymentTool", () => {
  const sourceKeypair = Keypair.random();
  const recipientKeypair = Keypair.random();
  const VALID_RECIPIENT = recipientKeypair.publicKey();

  beforeEach(() => {
    process.env.STELLAR_PRIVATE_KEY = sourceKeypair.secret();
    mockLoadAccount.mockResolvedValue(
      new Account(sourceKeypair.publicKey(), "0")
    );
    mockSubmitTransaction.mockResolvedValue({ hash: "testhash" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.STELLAR_PRIVATE_KEY;
  });

  describe("input validation", () => {
    it("rejects an invalid recipient address", async () => {
      const result = await stellarSendPaymentTool.func({
        recipient: "not-a-stellar-address",
        amount: "10",
      });
      expect(result).toContain("Transaction failed");
      expect(result).toContain("Invalid recipient address");
    });

    it("rejects a non-positive amount", async () => {
      const result = await stellarSendPaymentTool.func({
        recipient: VALID_RECIPIENT,
        amount: "-5",
      });
      expect(result).toContain("Transaction failed");
      expect(result).toContain("Amount must be a positive number");
    });

    it("rejects an invalid asset issuer", async () => {
      const result = await stellarSendPaymentTool.func({
        recipient: VALID_RECIPIENT,
        amount: "10",
        asset: { code: "USDC", issuer: "not-a-valid-issuer" },
      });
      expect(result).toContain("Transaction failed");
      expect(result).toContain("Invalid asset issuer address");
    });

    it("rejects a missing private key", async () => {
      delete process.env.STELLAR_PRIVATE_KEY;
      const result = await stellarSendPaymentTool.func({
        recipient: VALID_RECIPIENT,
        amount: "10",
      });
      expect(result).toContain("Transaction failed");
      expect(result).toContain("Invalid or missing Stellar private key");
    });
  });

  describe("native XLM payment", () => {
    it("submits a native XLM payment when no asset is specified", async () => {
      const result = await stellarSendPaymentTool.func({
        recipient: VALID_RECIPIENT,
        amount: "10",
      });
      expect(result).toBe("Transaction successful! Hash: testhash");
      const submittedTx = mockSubmitTransaction.mock.calls[0][0];
      const op = submittedTx.operations[0];
      expect(op.type).toBe("payment");
      expect(op.asset.isNative()).toBe(true);
      expect(op.amount).toBe("10.0000000");
    });
  });

  describe("issued asset payment", () => {
    it("submits a payment with the specified issued asset", async () => {
      const issuerKeypair = Keypair.random();
      const result = await stellarSendPaymentTool.func({
        recipient: VALID_RECIPIENT,
        amount: "25",
        asset: { code: "USDC", issuer: issuerKeypair.publicKey() },
      });
      expect(result).toBe("Transaction successful! Hash: testhash");
      const submittedTx = mockSubmitTransaction.mock.calls[0][0];
      const op = submittedTx.operations[0];
      expect(op.type).toBe("payment");
      expect(op.asset.code).toBe("USDC");
      expect(op.asset.issuer).toBe(issuerKeypair.publicKey());
      expect(op.amount).toBe("25.0000000");
    });
  });
});
