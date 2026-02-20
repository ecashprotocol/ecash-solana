import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createCreateMetadataAccountV3Instruction } from "@metaplex-foundation/mpl-token-metadata";
import { readFileSync } from "fs";

// Config
const PROGRAM_ID = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
const MINT = new PublicKey("7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7");
const RPC_URL = "https://api.mainnet-beta.solana.com";
const DEPLOYER_PATH = "/Users/xen/ecash-solana/deployer.json";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const MINT_SEED = Buffer.from("ecash_mint");

const TOKEN_NAME = "Ecash";
const TOKEN_SYMBOL = "ECASH";
const TOKEN_URI = "https://raw.githubusercontent.com/ecashprotocol/ecash-solana/main/token-metadata.json";

async function main() {
  console.log("Creating Metaplex Token Metadata...");

  // Load deployer
  const deployerKey = JSON.parse(readFileSync(DEPLOYER_PATH, "utf8"));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerKey));
  console.log("Deployer:", deployer.publicKey.toBase58());

  const connection = new Connection(RPC_URL, "confirmed");

  // Derive metadata PDA
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      MINT.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  console.log("Metadata PDA:", metadataPda.toBase58());

  // Check if already exists
  const metadataInfo = await connection.getAccountInfo(metadataPda);
  if (metadataInfo) {
    console.log("Metadata already exists!");
    return;
  }

  // The mint authority is the mint PDA itself
  // We need to sign with the program's PDA, which requires using our program's create_token_metadata instruction
  // Since we can't sign for the PDA directly, let's check if there's another way

  // Actually, for Token-2022 mints where the mint authority is a PDA,
  // we need to use our program's CPI to create metadata
  // Let's try calling our program's create_token_metadata instruction

  console.log("\nNote: The mint authority is a PDA controlled by the Ecash program.");
  console.log("To create metadata, we need to use the program's create_token_metadata instruction.");
  console.log("\nSince the IDL doesn't include this instruction yet, you have two options:");
  console.log("1. Regenerate the IDL with anchor build (requires fixing proc_macro2 issue)");
  console.log("2. Use metaboss or another tool that can handle PDA-controlled mints");
  console.log("\nAlternatively, add token metadata before deployment in the initialize instruction.");
}

main().catch(console.error);
