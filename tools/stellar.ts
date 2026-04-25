import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as StellarSdk from "stellar-sdk";

export const stellarSendPaymentTool = new DynamicStructuredTool({
  name: "stellar_send_payment",
  description:
    "Send a payment on the Stellar testnet. Supports native XLM and issued assets " +
    "(e.g. USDC, EURC). Requires recipient address and amount. " +
    "Optionally specify an asset; defaults to native XLM.",
  schema: z.object({
    recipient: z.string().describe("The Stellar address to send to"),
    amount: z.string().describe("The amount to send (as a string)"),
    asset: z
      .object({
        code: z.string().min(1).max(12).describe("Asset code, e.g. USDC"),
        issuer: z.string().describe("Asset issuer public key"),
      })
      .optional()
      .describe("Issued asset to send. Omit to send native XLM."),
  }),
  func: async ({
    recipient,
    amount,
    asset,
  }: {
    recipient: string;
    amount: string;
    asset?: { code: string; issuer: string };
  }) => {
    try {
      // Step 1: Validate inputs
      if (!StellarSdk.StrKey.isValidEd25519PublicKey(recipient)) {
        throw new Error("Invalid recipient address.");
      }
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        throw new Error("Amount must be a positive number.");
      }
      if (asset && !StellarSdk.StrKey.isValidEd25519PublicKey(asset.issuer)) {
        throw new Error("Invalid asset issuer address.");
      }

      // Step 2: Get private key from environment
      const privateKey = process.env.STELLAR_PRIVATE_KEY as string;
      if (!privateKey || !StellarSdk.StrKey.isValidEd25519SecretSeed(privateKey)) {
        throw new Error("Invalid or missing Stellar private key in environment.");
      }
      const keypair = StellarSdk.Keypair.fromSecret(privateKey);
      const sourcePublicKey = keypair.publicKey();

      // Step 3: Resolve the payment asset
      const paymentAsset = asset
        ? new StellarSdk.Asset(asset.code, asset.issuer)
        : StellarSdk.Asset.native();

      // Step 4: Create an unsigned transaction
      const server = new StellarSdk.Horizon.Server("https://horizon-testnet.stellar.org");
      const account = await server.loadAccount(sourcePublicKey);

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: recipient,
            asset: paymentAsset,
            amount: amount,
          })
        )
        .setTimeout(300)
        .build();

      // Step 5: Sign the transaction with the private key
      transaction.sign(keypair);
      const signedTxXdr = transaction.toXDR();

      // Step 6: Submit the transaction
      const tx = new StellarSdk.Transaction(signedTxXdr, StellarSdk.Networks.TESTNET);
      const response = await server.submitTransaction(tx);

      return `Transaction successful! Hash: ${response.hash}`;
    } catch (error) {
      const errorMessage =
        (error as { response?: { data?: { title?: string } }; message?: string })
          .response?.data?.title ||
        (error as Error).message ||
        "Unknown error occurred";
      return `Transaction failed: ${errorMessage}`;
    }
  },
});