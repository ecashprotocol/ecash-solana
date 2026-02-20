// Phase 17: Fresh Deploy - Register 3 miners, enter batch 0, solve 10 puzzles
// Uses NEW program: w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY
// Uses Solana mainnet merkle proofs

const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } = require("@solana/spl-token");
const { keccak_256 } = require("js-sha3");
const fs = require("fs");
const path = require("path");
const os = require("os");

// NEW PROGRAM ADDRESSES
const PROGRAM_ID = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
const MINT = new PublicKey("7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7");
const VAULT = new PublicKey("HP5d2aqS3wzc13SwbzojDrhZDjFDYC6RNvH5R8q8Bb6d");
const GLOBAL_STATE = new PublicKey("ELXyB21ZTJiQUHf3pu4W95AiYJ14EDByCqX2JzPZtZqS");

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINER_STATE_SEED = Buffer.from("miner_state");
const PUZZLE_SOLVED_SEED = Buffer.from("puzzle_solved");
const VAULT_SEED = Buffer.from("vault");

const NOT_IN_BATCH = new BN("18446744073709551615");

const keccak = (data) => Buffer.from(keccak_256.arrayBuffer(data));

const loadWallet = (n) => Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), `ecash-solana/${n}.json`))))
);

// Load puzzle data from Solana mainnet merkle tree
const loadPuzzleData = () => {
  const proofsPath = path.join(os.homedir(), "ecash-protocol-v3/merkle/merkle-proofs.json");
  const proofs = JSON.parse(fs.readFileSync(proofsPath, "utf-8"));
  return proofs;
};

function hexToBuffer(hex) {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  return Buffer.from(hex, "hex");
}

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 17: FRESH DEPLOY - MINING TO SILVER TIER");
  console.log("=".repeat(60));
  console.log("\nProgram: " + PROGRAM_ID.toString());
  console.log("Mint: " + MINT.toString());
  console.log("Vault: " + VAULT.toString());
  console.log("Global State: " + GLOBAL_STATE.toString());

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const deployer = loadWallet("deployer");
  const w1 = loadWallet("wallet-1");
  const w2 = loadWallet("wallet-2");
  const w3 = loadWallet("wallet-3");
  const wallets = [
    { name: "W1", wallet: w1 },
    { name: "W2", wallet: w2 },
    { name: "W3", wallet: w3 },
  ];

  // Load IDL - need to update address in IDL for the new program
  const idlPath = path.join(__dirname, "../target/idl/ecash_program.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  idl.address = PROGRAM_ID.toString(); // Override IDL address

  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(deployer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const prog = new anchor.Program(idl, provider);

  // Load puzzle data
  const puzzleData = loadPuzzleData();
  console.log(`\nLoaded ${Object.keys(puzzleData).length} puzzles from Solana mainnet merkle tree`);

  // Helper functions
  const getMinerPda = (pubkey) => PublicKey.findProgramAddressSync([MINER_STATE_SEED, pubkey.toBuffer()], PROGRAM_ID)[0];
  const getPuzzleSolvedPda = (id) => PublicKey.findProgramAddressSync([PUZZLE_SOLVED_SEED, new BN(id).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];

  // ============================================================
  // STEP 1: Register 3 wallets as miners
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  STEP 1: REGISTER MINERS");
  console.log("=".repeat(60));

  for (const { name, wallet } of wallets) {
    const minerPda = getMinerPda(wallet.publicKey);

    // Check if already registered
    try {
      const state = await prog.account.minerState.fetch(minerPda);
      console.log(`[SKIP] ${name} already registered (gas=${state.gasBalance.toString()})`);
      continue;
    } catch {
      // Not registered, proceed
    }

    try {
      const walletProvider = new anchor.AnchorProvider(conn, new anchor.Wallet(wallet), { commitment: "confirmed" });
      const walletProg = new anchor.Program(idl, walletProvider);

      const tx = await walletProg.methods
        .register(PublicKey.default) // No referrer
        .accounts({
          owner: wallet.publicKey,
          minerState: minerPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet])
        .rpc();

      await conn.confirmTransaction(tx, "confirmed");
      console.log(`[OK] ${name} registered: ${tx.slice(0, 16)}...`);
    } catch (e) {
      console.log(`[ERROR] ${name} register failed: ${e.message.slice(0, 60)}`);
      return;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // ============================================================
  // STEP 2: Have all 3 enter batch 0
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  STEP 2: ENTER BATCH 0");
  console.log("=".repeat(60));

  for (const { name, wallet } of wallets) {
    const minerPda = getMinerPda(wallet.publicKey);
    const ata = getAssociatedTokenAddressSync(MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);

    // Check current state
    const state = await prog.account.minerState.fetch(minerPda);
    if (!state.enteredBatch.eq(NOT_IN_BATCH)) {
      console.log(`[SKIP] ${name} already in batch ${state.enteredBatch.toString()}`);
      continue;
    }

    // Check token balance
    try {
      const tokenBal = await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
      console.log(`${name} token balance: ${Number(tokenBal.amount) / 1e9} ECASH`);

      if (Number(tokenBal.amount) < 1000e9) {
        console.log(`[ERROR] ${name} needs at least 1000 ECASH to enter batch`);
        return;
      }
    } catch (e) {
      console.log(`[ERROR] ${name} has no token account or no tokens: ${e.message.slice(0, 40)}`);
      return;
    }

    try {
      const walletProvider = new anchor.AnchorProvider(conn, new anchor.Wallet(wallet), { commitment: "confirmed" });
      const walletProg = new anchor.Program(idl, walletProvider);

      const tx = await walletProg.methods
        .enterBatch()
        .accounts({
          owner: wallet.publicKey,
          minerState: minerPda,
          globalState: GLOBAL_STATE,
          mint: MINT,
          minerTokenAccount: ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([wallet])
        .rpc();

      await conn.confirmTransaction(tx, "confirmed");
      console.log(`[OK] ${name} entered batch 0: ${tx.slice(0, 16)}...`);
    } catch (e) {
      console.log(`[ERROR] ${name} enterBatch failed: ${e.message.slice(0, 80)}`);
      return;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // ============================================================
  // STEP 3: Solve 10 puzzles across wallets
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  STEP 3: SOLVE 10 PUZZLES");
  console.log("=".repeat(60));

  let totalSolved = 0;
  let walletSolves = { W1: 0, W2: 0, W3: 0 };
  let currentWalletIdx = 0;

  // We'll distribute puzzles: W1 gets 10 solves (for Silver tier requirement)
  const TARGET_SOLVES = 10;

  for (let puzzleId = 0; puzzleId < TARGET_SOLVES && totalSolved < TARGET_SOLVES; puzzleId++) {
    // Use W1 for all 10 solves to ensure one wallet reaches Silver tier
    const { name, wallet } = wallets[0]; // Always use W1
    const minerPda = getMinerPda(wallet.publicKey);
    const ata = getAssociatedTokenAddressSync(MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const puzzleSolvedPda = getPuzzleSolvedPda(puzzleId);

    // Check if puzzle already solved
    try {
      await prog.account.puzzleSolved.fetch(puzzleSolvedPda);
      console.log(`[SKIP] Puzzle ${puzzleId} already solved`);
      continue;
    } catch {
      // Not solved yet
    }

    // Get puzzle data
    const puz = puzzleData[String(puzzleId)];
    if (!puz) {
      console.log(`[ERROR] No puzzle data for puzzle ${puzzleId}`);
      return;
    }

    console.log(`\n--- Solving puzzle ${puzzleId} with ${name} ---`);
    console.log(`  Answer: "${puz.answer}"`);

    const walletProvider = new anchor.AnchorProvider(conn, new anchor.Wallet(wallet), { commitment: "confirmed" });
    const walletProg = new anchor.Program(idl, walletProvider);

    // Check miner state
    let minerState = await prog.account.minerState.fetch(minerPda);

    // Clear any expired commits
    if (minerState.hasCommit) {
      const currentSlot = await conn.getSlot();
      if (currentSlot > minerState.commitSlot.toNumber() + 300) {
        try {
          const cancelTx = await walletProg.methods
            .cancelExpiredCommit()
            .accounts({ owner: wallet.publicKey, minerState: minerPda })
            .signers([wallet])
            .rpc();
          await conn.confirmTransaction(cancelTx, "confirmed");
          console.log(`  Cancelled expired commit`);
          minerState = await prog.account.minerState.fetch(minerPda);
        } catch (e) {
          console.log(`  Could not cancel commit: ${e.message.slice(0, 40)}`);
        }
      }
    }

    // Step 3a: Pick puzzle
    if (!minerState.hasPick || minerState.activePick.toNumber() !== puzzleId) {
      if (minerState.hasPick) {
        console.log(`  Has pick for puzzle ${minerState.activePick}, need to clear first`);
        // Try to clear the pick (if puzzle was solved)
        try {
          const oldPuzzleSolvedPda = getPuzzleSolvedPda(minerState.activePick.toNumber());
          const clearTx = await walletProg.methods
            .clearSolvedPick()
            .accounts({ owner: wallet.publicKey, minerState: minerPda, puzzleSolved: oldPuzzleSolvedPda })
            .signers([wallet])
            .rpc();
          await conn.confirmTransaction(clearTx, "confirmed");
          console.log(`  Cleared old pick`);
          minerState = await prog.account.minerState.fetch(minerPda);
        } catch (e) {
          console.log(`[ERROR] Cannot clear pick: ${e.message.slice(0, 40)}`);
          return;
        }
      }

      try {
        const pickTx = await walletProg.methods
          .pick(new BN(puzzleId))
          .accounts({
            owner: wallet.publicKey,
            minerState: minerPda,
            globalState: GLOBAL_STATE,
          })
          .signers([wallet])
          .rpc();
        await conn.confirmTransaction(pickTx, "confirmed");
        console.log(`  Picked puzzle ${puzzleId}: ${pickTx.slice(0, 16)}...`);
      } catch (e) {
        console.log(`[ERROR] Pick failed: ${e.message.slice(0, 60)}`);
        return;
      }
      await new Promise(r => setTimeout(r, 500));
    } else {
      console.log(`  Already has pick for puzzle ${puzzleId}`);
    }

    // Step 3b: Commit
    // Commit hash = keccak(answer + salt + secret + owner)
    const salt = hexToBuffer(puz.salt);
    const secret = keccak(Buffer.concat([Buffer.from("secret"), wallet.publicKey.toBuffer(), new BN(puzzleId).toArrayLike(Buffer, "le", 8)]));
    const commitHash = keccak(Buffer.concat([Buffer.from(puz.answer), salt, secret, wallet.publicKey.toBuffer()]));

    minerState = await prog.account.minerState.fetch(minerPda);
    if (!minerState.hasCommit) {
      try {
        const commitTx = await walletProg.methods
          .commitSolve(Array.from(commitHash))
          .accounts({
            owner: wallet.publicKey,
            minerState: minerPda,
          })
          .signers([wallet])
          .rpc();
        await conn.confirmTransaction(commitTx, "confirmed");
        console.log(`  Committed: ${commitTx.slice(0, 16)}...`);
      } catch (e) {
        console.log(`[ERROR] Commit failed: ${e.message.slice(0, 60)}`);
        return;
      }
      // Wait for next slot
      await new Promise(r => setTimeout(r, 1500));
    } else {
      console.log(`  Already has commit`);
    }

    // Step 3c: Reveal
    const proof = puz.proof.map(p => Array.from(hexToBuffer(p)));

    try {
      const balBefore = Number((await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);

      const revealTx = await walletProg.methods
        .revealSolve(puz.answer, Array.from(salt), Array.from(secret), proof)
        .accounts({
          owner: wallet.publicKey,
          minerState: minerPda,
          globalState: GLOBAL_STATE,
          puzzleSolved: puzzleSolvedPda,
          mint: MINT,
          vault: VAULT,
          minerTokenAccount: ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet])
        .rpc();

      await conn.confirmTransaction(revealTx, "confirmed");
      const balAfter = Number((await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
      const reward = (balAfter - balBefore) / 1e9;

      console.log(`  [SOLVED] Puzzle ${puzzleId}! Reward: ${reward} ECASH`);
      console.log(`  TX: ${revealTx}`);
      totalSolved++;
      walletSolves[name]++;
    } catch (e) {
      console.log(`[ERROR] Reveal failed: ${e.message}`);
      console.log(`  Full error: ${JSON.stringify(e.logs || [], null, 2)}`);
      return;
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // ============================================================
  // STEP 4: Verify Silver tier
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  STEP 4: VERIFY SILVER TIER");
  console.log("=".repeat(60));

  let hasSilver = false;
  for (const { name, wallet } of wallets) {
    const minerPda = getMinerPda(wallet.publicKey);
    const state = await prog.account.minerState.fetch(minerPda);
    const solves = state.solveCount.toNumber();
    const tier = solves >= 50 ? "Diamond" : solves >= 25 ? "Gold" : solves >= 10 ? "Silver" : solves >= 1 ? "Bronze" : "Unranked";
    console.log(`${name}: ${solves} solves (${tier})`);
    if (solves >= 10) hasSilver = true;
  }

  if (hasSilver) {
    console.log("\n[SUCCESS] At least one wallet reached Silver tier!");
  } else {
    console.log("\n[FAIL] No wallet reached Silver tier yet");
  }

  // ============================================================
  // STEP 5: Print final state
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  STEP 5: FINAL STATE");
  console.log("=".repeat(60));

  const gs = await prog.account.globalState.fetch(GLOBAL_STATE);
  const vaultBal = Number((await getAccount(conn, VAULT, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;

  console.log("\n--- Global State ---");
  console.log(`Total Solved: ${gs.totalSolved.toString()}`);
  console.log(`Total Burned: ${Number(gs.totalBurned) / 1e9} ECASH`);
  console.log(`Current Batch: ${gs.currentBatch.toString()}`);
  console.log(`Batch Solve Count: ${gs.batchSolveCount.toString()}`);
  console.log(`Vault Balance: ${vaultBal.toFixed(2)} ECASH`);

  console.log("\n--- Wallet States ---");
  for (const { name, wallet } of wallets) {
    const minerPda = getMinerPda(wallet.publicKey);
    const ata = getAssociatedTokenAddressSync(MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const state = await prog.account.minerState.fetch(minerPda);

    let tokenBal = 0;
    try {
      tokenBal = Number((await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;
    } catch {}

    console.log(`\n${name} (${wallet.publicKey.toString().slice(0, 12)}...):`);
    console.log(`  Solve Count: ${state.solveCount.toString()}`);
    console.log(`  Gas Balance: ${state.gasBalance.toString()}`);
    console.log(`  Token Balance: ${tokenBal.toFixed(2)} ECASH`);
    console.log(`  Entered Batch: ${state.enteredBatch.eq(NOT_IN_BATCH) ? "None" : state.enteredBatch.toString()}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 17 COMPLETE");
  console.log("=".repeat(60));
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
