const anchor = require("@coral-xyz/anchor");
const { PublicKey, Keypair, SystemProgram, Connection } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINT_SEED = Buffer.from("ecash_mint");
const VAULT_SEED = Buffer.from("vault");

async function main() {
  const deployerPath = path.join(process.env.HOME, "ecash-solana/deployer-new.json");
  const deployerKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(deployerPath, "utf-8")))
  );

  console.log("Deployer:", deployerKeypair.publicKey.toString());

  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  const wallet = new anchor.Wallet(deployerKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idlPath = path.join(process.env.HOME, "ecash-solana/ecash_program/target/idl/ecash_program.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  const programId = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
  const program = new anchor.Program(idl, provider);

  // Derive PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], programId);
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
    console.log("\n=== Step 2: Initialize Vault ===");
    
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
      await connection.confirmTransaction(tx2, "confirmed");
      console.log("initializeVault confirmed!");
    } catch (e) {
      console.error("initializeVault error:", e);
      throw e;
    }
  }

  console.log("\n=== INITIALIZATION COMPLETE ===");
}

main().catch(console.error);
