import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Connection,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINT_SEED = Buffer.from("ecash_mint");
const VAULT_SEED = Buffer.from("vault");

async function main() {
  // Load deployer keypair
  const deployerPath = path.join(process.env.HOME!, "ecash-solana/deployer-new.json");
  const deployerKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(deployerPath, "utf-8")))
  );

  console.log("Deployer:", deployerKeypair.publicKey.toString());

  // Connect to mainnet
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  // Create wallet and provider
  const wallet = new anchor.Wallet(deployerKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load IDL
  const idlPath = path.join(__dirname, "../target/idl/ecash_program.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  const programId = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
  const program = new Program(idl, provider);

  // Derive PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [GLOBAL_STATE_SEED],
    programId
  );
  const [mintPda] = PublicKey.findProgramAddressSync([MINT_SEED], programId);
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED], programId);

  console.log("Global State PDA:", globalStatePda.toString());
  console.log("Mint PDA:", mintPda.toString());
  console.log("Vault PDA:", vaultPda.toString());

  // Check if already initialized
  const globalStateInfo = await connection.getAccountInfo(globalStatePda);
  if (globalStateInfo) {
    console.log("Program already initialized! Skipping initializeState...");
  } else {
    // Step 1: Initialize State
    console.log("\n=== Step 1: Initialize State ===");
    try {
      const tx1 = await program.methods
        .initializeState()
        .accounts({
          authority: deployerKeypair.publicKey,
          globalState: globalStatePda,
          mint: mintPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([deployerKeypair])
        .rpc();

      console.log("initializeState tx:", tx1);
      console.log("Waiting for confirmation...");
      await connection.confirmTransaction(tx1, "confirmed");
      console.log("initializeState confirmed!");
    } catch (e) {
      console.error("initializeState error:", e);
      throw e;
    }
  }

  // Check if vault exists
  const vaultInfo = await connection.getAccountInfo(vaultPda);
  if (vaultInfo) {
    console.log("Vault already initialized! Skipping initializeVault...");
  } else {
    // Step 2: Initialize Vault
    console.log("\n=== Step 2: Initialize Vault ===");

    // Authority's associated token account
    const authorityAta = getAssociatedTokenAddressSync(
      mintPda,
      deployerKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    console.log("Authority ATA:", authorityAta.toString());

    try {
      const tx2 = await program.methods
        .initializeVault()
        .accounts({
          authority: deployerKeypair.publicKey,
          globalState: globalStatePda,
          mint: mintPda,
          vault: vaultPda,
          authorityTokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([deployerKeypair])
        .rpc();

      console.log("initializeVault tx:", tx2);
      console.log("Waiting for confirmation...");
      await connection.confirmTransaction(tx2, "confirmed");
      console.log("initializeVault confirmed!");
    } catch (e) {
      console.error("initializeVault error:", e);
      throw e;
    }
  }

  // Verify initialization
  console.log("\n=== Verification ===");

  const globalState = await program.account.globalState.fetch(globalStatePda);
  console.log("Authority:", globalState.authority.toString());
  console.log("Mint:", globalState.mint.toString());
  console.log("Total Solved:", globalState.totalSolved.toString());
  console.log("Is Renounced:", globalState.isRenounced);

  // Check token balances
  const authorityAta = getAssociatedTokenAddressSync(
    mintPda,
    deployerKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  try {
    const { getAccount } = await import("@solana/spl-token");
    const authorityBalance = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const vaultBalance = await getAccount(connection, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID);

    console.log("\nToken Balances:");
    console.log("Authority (LP):", Number(authorityBalance.amount) / 1e9, "ECASH");
    console.log("Vault (Mining):", Number(vaultBalance.amount) / 1e9, "ECASH");
    console.log("Total:", (Number(authorityBalance.amount) + Number(vaultBalance.amount)) / 1e9, "ECASH");
  } catch (e) {
    console.log("Could not fetch token balances:", e);
  }

  console.log("\n=== INITIALIZATION COMPLETE ===");
}

main().catch(console.error);
