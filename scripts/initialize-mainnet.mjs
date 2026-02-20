import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import { readFileSync } from "fs";

// ============================================================================
// CONFIGURATION
// ============================================================================

const PROGRAM_ID = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
const RPC_URL = "https://api.mainnet-beta.solana.com";
const DEPLOYER_PATH = "/Users/xen/ecash-solana/deployer.json";

// PDA Seeds
const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINT_SEED = Buffer.from("ecash_mint");
const VAULT_SEED = Buffer.from("vault");

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("Ecash Mainnet Initialization (with Token-2022 Metadata)");
  console.log("=".repeat(60));

  // Load deployer keypair
  const deployerKey = JSON.parse(readFileSync(DEPLOYER_PATH, "utf8"));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerKey));
  console.log("Deployer:", deployer.publicKey.toBase58());

  // Setup connection and provider
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(deployer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  // Load IDL and create program
  const idl = JSON.parse(readFileSync("/Users/xen/ecash-solana/ecash_program/target/idl/ecash_program.json", "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  const program = new Program(idl, provider);

  // Derive PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [GLOBAL_STATE_SEED],
    PROGRAM_ID
  );
  const [mintPda] = PublicKey.findProgramAddressSync(
    [MINT_SEED],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [VAULT_SEED],
    PROGRAM_ID
  );

  console.log("\nDerived PDAs:");
  console.log("  GlobalState:", globalStatePda.toBase58());
  console.log("  Mint:", mintPda.toBase58());
  console.log("  Vault:", vaultPda.toBase58());

  // Check balance
  const balance = await connection.getBalance(deployer.publicKey);
  console.log("\nDeployer balance:", (balance / 1e9).toFixed(4), "SOL");

  if (balance < 0.05 * 1e9) {
    console.error("ERROR: Insufficient balance for initialization");
    process.exit(1);
  }

  // Check if already initialized
  const globalStateInfo = await connection.getAccountInfo(globalStatePda);
  if (globalStateInfo) {
    console.log("\n⚠️  GlobalState already exists! Skipping initialize_state...");
  } else {
    // Step 1: Initialize State (now includes Token-2022 metadata!)
    console.log("\n[1/2] Initializing state + token metadata...");
    try {
      const tx1 = await program.methods
        .initializeState()
        .accounts({
          authority: deployer.publicKey,
          globalState: globalStatePda,
          mint: mintPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      console.log("  TX:", tx1);
      console.log("  ✅ State + metadata initialized");
    } catch (e) {
      console.error("  ❌ Failed:", e.message);
      console.error("  Full error:", e);
      throw e;
    }
  }

  // Check if vault exists
  const vaultInfo = await connection.getAccountInfo(vaultPda);
  if (vaultInfo) {
    console.log("\n⚠️  Vault already exists! Skipping initialize_vault...");
  } else {
    // Step 2: Initialize Vault
    console.log("\n[2/2] Initializing vault...");

    // Get deployer's ATA
    const deployerAta = getAssociatedTokenAddressSync(
      mintPda,
      deployer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    console.log("  Deployer ATA:", deployerAta.toBase58());

    try {
      const tx2 = await program.methods
        .initializeVault()
        .accounts({
          authority: deployer.publicKey,
          globalState: globalStatePda,
          mint: mintPda,
          vault: vaultPda,
          authorityTokenAccount: deployerAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      console.log("  TX:", tx2);
      console.log("  ✅ Vault initialized");
    } catch (e) {
      console.error("  ❌ Failed:", e.message);
      throw e;
    }
  }

  // Final verification
  console.log("\n" + "=".repeat(60));
  console.log("VERIFICATION");
  console.log("=".repeat(60));

  // Verify global state
  const globalState = await program.account.globalState.fetch(globalStatePda);
  console.log("\nGlobal State:");
  console.log("  Authority:", globalState.authority.toBase58());
  console.log("  Mint:", globalState.mint.toBase58());
  console.log("  Total Solved:", globalState.totalSolved.toString());
  console.log("  Is Renounced:", globalState.isRenounced);

  // Check mint
  const mintInfo = await connection.getAccountInfo(mintPda);
  console.log("\nMint Account:", mintPda.toBase58());
  console.log("  Exists:", !!mintInfo);

  // Check deployer token balance
  const deployerAta = getAssociatedTokenAddressSync(
    mintPda,
    deployer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  try {
    const ataInfo = await connection.getTokenAccountBalance(deployerAta);
    console.log("  LP Allocation in deployer ATA:", ataInfo.value.uiAmountString, "ECASH");
  } catch (e) {
    console.log("  LP Allocation: Not yet received");
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Mint Address:", mintPda.toBase58());
  console.log("Global State:", globalStatePda.toBase58());
  console.log("Vault:", vaultPda.toBase58());
  console.log("\nView on Solscan:");
  console.log("  Program: https://solscan.io/account/" + PROGRAM_ID.toBase58());
  console.log("  Token: https://solscan.io/token/" + mintPda.toBase58());
}

main().catch(console.error);
