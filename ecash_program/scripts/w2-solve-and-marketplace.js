// W2: Solve puzzle, create profile, complete marketplace flow
const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } = require("@solana/spl-token");
const { keccak_256 } = require("js-sha3");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROGRAM_ID = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
const MINT = new PublicKey("7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7");
const VAULT = new PublicKey("HP5d2aqS3wzc13SwbzojDrhZDjFDYC6RNvH5R8q8Bb6d");
const GLOBAL_STATE = new PublicKey("ELXyB21ZTJiQUHf3pu4W95AiYJ14EDByCqX2JzPZtZqS");

const MINER_STATE_SEED = Buffer.from("miner_state");
const PUZZLE_SOLVED_SEED = Buffer.from("puzzle_solved");
const AGENT_PROFILE_SEED = Buffer.from("agent_profile");
const JOB_SEED = Buffer.from("job");
const JOB_ESCROW_SEED = Buffer.from("job_escrow");

const keccak = (data) => Buffer.from(keccak_256.arrayBuffer(data));

const loadWallet = (n) => Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), `ecash-solana/${n}.json`))))
);

function hexToBuffer(hex) {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  return Buffer.from(hex, "hex");
}

const loadPuzzleData = () => {
  const proofsPath = path.join(os.homedir(), "ecash-protocol-v3/merkle/merkle-proofs.json");
  return JSON.parse(fs.readFileSync(proofsPath, "utf-8"));
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log("============================================================");
  console.log("  W2: SOLVE PUZZLE + CREATE PROFILE + MARKETPLACE FLOW");
  console.log("============================================================\n");

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const w1 = loadWallet("wallet-1"); // Hirer
  const w2 = loadWallet("wallet-2"); // Worker

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  idl.address = PROGRAM_ID.toString();

  const w1Provider = new anchor.AnchorProvider(conn, new anchor.Wallet(w1), { commitment: "confirmed" });
  const w2Provider = new anchor.AnchorProvider(conn, new anchor.Wallet(w2), { commitment: "confirmed" });
  const w1Prog = new anchor.Program(idl, w1Provider);
  const w2Prog = new anchor.Program(idl, w2Provider);

  const puzzleData = loadPuzzleData();

  // PDAs
  const w2MinerPda = PublicKey.findProgramAddressSync([MINER_STATE_SEED, w2.publicKey.toBuffer()], PROGRAM_ID)[0];
  const w2ProfilePda = PublicKey.findProgramAddressSync([AGENT_PROFILE_SEED, w2.publicKey.toBuffer()], PROGRAM_ID)[0];
  const w2Ata = getAssociatedTokenAddressSync(MINT, w2.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const w1Ata = getAssociatedTokenAddressSync(MINT, w1.publicKey, false, TOKEN_2022_PROGRAM_ID);

  console.log("W2 Public Key:", w2.publicKey.toString());
  console.log("W2 Miner PDA:", w2MinerPda.toString());
  console.log("W2 Profile PDA:", w2ProfilePda.toString());

  // ================================================================
  // PART 1: W2 solves a puzzle
  // ================================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PART 1: W2 SOLVES A PUZZLE");
  console.log("=".repeat(60));

  // Check W2 miner state
  let w2Miner = await w2Prog.account.minerState.fetch(w2MinerPda);
  console.log("\nW2 current solve count:", w2Miner.solveCount.toString());
  console.log("W2 entered batch:", w2Miner.enteredBatch.toString());

  // Get global state for current batch
  const gs = await w2Prog.account.globalState.fetch(GLOBAL_STATE);
  console.log("Global current batch:", gs.currentBatch.toString());

  // Enter batch 1 if needed
  if (w2Miner.enteredBatch.toNumber() < gs.currentBatch.toNumber()) {
    console.log("\n--- W2 entering batch 1 ---");
    try {
      const tx = await w2Prog.methods
        .enterBatch()
        .accounts({
          owner: w2.publicKey,
          minerState: w2MinerPda,
          globalState: GLOBAL_STATE,
          mint: MINT,
          minerTokenAccount: w2Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      await conn.confirmTransaction(tx, "confirmed");
      console.log("[OK] Entered batch:", tx.slice(0, 20) + "...");
      await sleep(1500);
    } catch (e) {
      console.log("[ERROR] enterBatch:", e.message.slice(0, 80));
      // May already be in batch
    }
  }

  // Find an unsolved puzzle in batch 1 (puzzles 10-19)
  const batchStart = gs.currentBatch.toNumber() * 10;
  let puzzleId = null;

  for (let i = batchStart; i < batchStart + 10; i++) {
    const puzzleSolvedPda = PublicKey.findProgramAddressSync(
      [PUZZLE_SOLVED_SEED, new BN(i).toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID
    )[0];
    try {
      await conn.getAccountInfo(puzzleSolvedPda);
      const info = await conn.getAccountInfo(puzzleSolvedPda);
      if (!info || info.data.length === 0) {
        puzzleId = i;
        break;
      }
    } catch {
      puzzleId = i;
      break;
    }
  }

  if (puzzleId === null) {
    // All puzzles in batch solved, try next one
    for (let i = batchStart; i < batchStart + 10; i++) {
      const puzzleSolvedPda = PublicKey.findProgramAddressSync(
        [PUZZLE_SOLVED_SEED, new BN(i).toArrayLike(Buffer, "le", 8)],
        PROGRAM_ID
      )[0];
      const info = await conn.getAccountInfo(puzzleSolvedPda);
      if (!info) {
        puzzleId = i;
        break;
      }
    }
  }

  // Check puzzles 12-19 for unsolved
  for (let i = 12; i <= 19; i++) {
    const puzzleSolvedPda = PublicKey.findProgramAddressSync(
      [PUZZLE_SOLVED_SEED, new BN(i).toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID
    )[0];
    const info = await conn.getAccountInfo(puzzleSolvedPda);
    if (!info) {
      puzzleId = i;
      console.log(`\nFound unsolved puzzle: ${i}`);
      break;
    }
  }

  if (puzzleId === null) {
    console.log("[ERROR] No unsolved puzzles found in batch 1");
    return;
  }

  const puz = puzzleData[String(puzzleId)];
  const puzzleSolvedPda = PublicKey.findProgramAddressSync(
    [PUZZLE_SOLVED_SEED, new BN(puzzleId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];

  console.log(`\n--- Solving puzzle ${puzzleId} ---`);
  console.log(`Answer: "${puz.answer}"`);

  // Pick
  w2Miner = await w2Prog.account.minerState.fetch(w2MinerPda);
  if (!w2Miner.hasPick || w2Miner.activePick.toNumber() !== puzzleId) {
    // Clear any existing pick if needed
    if (w2Miner.hasPick) {
      console.log("W2 has different pick, need to clear or use it");
    }

    try {
      const pickTx = await w2Prog.methods
        .pick(new BN(puzzleId))
        .accounts({
          owner: w2.publicKey,
          minerState: w2MinerPda,
          globalState: GLOBAL_STATE,
        })
        .rpc();
      await conn.confirmTransaction(pickTx, "confirmed");
      console.log("[OK] Picked puzzle:", pickTx.slice(0, 20) + "...");
      await sleep(1000);
    } catch (e) {
      console.log("[ERROR] pick:", e.message.slice(0, 80));
      return;
    }
  }

  // Commit
  const salt = hexToBuffer(puz.salt);
  const secret = keccak(Buffer.concat([
    Buffer.from("secret"),
    w2.publicKey.toBuffer(),
    new BN(puzzleId).toArrayLike(Buffer, "le", 8)
  ]));
  const commitHash = keccak(Buffer.concat([
    Buffer.from(puz.answer),
    salt,
    secret,
    w2.publicKey.toBuffer()
  ]));

  w2Miner = await w2Prog.account.minerState.fetch(w2MinerPda);
  if (!w2Miner.hasCommit) {
    try {
      const commitTx = await w2Prog.methods
        .commitSolve(Array.from(commitHash))
        .accounts({
          owner: w2.publicKey,
          minerState: w2MinerPda,
        })
        .rpc();
      await conn.confirmTransaction(commitTx, "confirmed");
      console.log("[OK] Committed:", commitTx.slice(0, 20) + "...");
      await sleep(1500); // Wait for slot to advance
    } catch (e) {
      console.log("[ERROR] commit:", e.message.slice(0, 80));
      return;
    }
  }

  // Reveal
  const proof = puz.proof.map(p => Array.from(hexToBuffer(p)));

  try {
    const balBefore = Number((await getAccount(conn, w2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);

    const revealTx = await w2Prog.methods
      .revealSolve(puz.answer, Array.from(salt), Array.from(secret), proof)
      .accounts({
        owner: w2.publicKey,
        minerState: w2MinerPda,
        globalState: GLOBAL_STATE,
        puzzleSolved: puzzleSolvedPda,
        mint: MINT,
        vault: VAULT,
        minerTokenAccount: w2Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await conn.confirmTransaction(revealTx, "confirmed");
    const balAfter = Number((await getAccount(conn, w2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    console.log("[SOLVED] Reward:", (balAfter - balBefore) / 1e9, "ECASH");
    console.log("TX:", revealTx);
    await sleep(2000);
  } catch (e) {
    console.log("[ERROR] reveal:", e.message);
    if (e.logs) e.logs.forEach(l => console.log("  ", l));
    return;
  }

  // Verify W2 solve count
  w2Miner = await w2Prog.account.minerState.fetch(w2MinerPda);
  console.log("\nW2 solve count after:", w2Miner.solveCount.toString());

  // ================================================================
  // PART 2: Create W2 Agent Profile
  // ================================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PART 2: CREATE W2 AGENT PROFILE");
  console.log("=".repeat(60));

  // Check if profile already exists
  let profileExists = false;
  try {
    const info = await conn.getAccountInfo(w2ProfilePda);
    if (info && info.data.length > 0) {
      profileExists = true;
      console.log("\nW2 profile already exists");
    }
  } catch {}

  if (!profileExists) {
    console.log("\n--- Registering W2 profile ---");
    try {
      const profileTx = await w2Prog.methods
        .registerProfile("Worker2-Agent", "Skilled puzzle solver and job worker")
        .accounts({
          owner: w2.publicKey,
          globalState: GLOBAL_STATE,
          minerState: w2MinerPda,
          agentProfile: w2ProfilePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await conn.confirmTransaction(profileTx, "confirmed");
      console.log("[OK] Profile registered:", profileTx.slice(0, 20) + "...");
      await sleep(1500);
    } catch (e) {
      console.log("[ERROR] registerProfile:", e.message);
      if (e.logs) e.logs.forEach(l => console.log("  ", l));
      return;
    }
  }

  // Read profile
  const profileBefore = await w2Prog.account.agentProfile.fetch(w2ProfilePda);
  console.log("\nW2 Profile:");
  console.log("  Name:", profileBefore.name);
  console.log("  Jobs completed as worker:", profileBefore.jobsCompletedAsWorker.toString());

  // ================================================================
  // PART 3: Full Marketplace Flow
  // ================================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PART 3: FULL MARKETPLACE FLOW");
  console.log("=".repeat(60));

  // Get fresh global state for next job ID
  const gsFresh = await w1Prog.account.globalState.fetch(GLOBAL_STATE);
  const nextJobId = gsFresh.nextJobId;
  console.log("\nNext Job ID:", nextJobId.toString());

  const [jobPda] = PublicKey.findProgramAddressSync(
    [JOB_SEED, nextJobId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
  const [jobEscrowPda] = PublicKey.findProgramAddressSync(
    [JOB_ESCROW_SEED, nextJobId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );

  console.log("Job PDA:", jobPda.toString());
  console.log("Job Escrow PDA:", jobEscrowPda.toString());

  // Get balances before
  const w1BalBefore = Number((await getAccount(conn, w1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;
  const w2BalBefore = Number((await getAccount(conn, w2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;

  console.log("\n--- Balances BEFORE ---");
  console.log("W1 (Hirer):", w1BalBefore.toFixed(2), "ECASH");
  console.log("W2 (Worker):", w2BalBefore.toFixed(2), "ECASH");

  // Step 1: W1 creates job (100 ECASH)
  console.log("\n--- Step 1: W1 creates job (100 ECASH, 24h deadline) ---");
  const jobAmount = new BN(100);
  const deadline = new BN(86400);

  try {
    const createTx = await w1Prog.methods
      .createJob(jobAmount, deadline, "Test marketplace job - verify 98/2 split")
      .accounts({
        hirer: w1.publicKey,
        globalState: GLOBAL_STATE,
        job: jobPda,
        jobEscrow: jobEscrowPda,
        mint: MINT,
        hirerTokenAccount: w1Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await conn.confirmTransaction(createTx, "confirmed");
    console.log("[OK] Job created:", createTx.slice(0, 20) + "...");
    await sleep(1500);
  } catch (e) {
    console.log("[ERROR] createJob:", e.message);
    if (e.logs) e.logs.forEach(l => console.log("  ", l));
    return;
  }

  // Check escrow balance
  const escrowBal = Number((await getAccount(conn, jobEscrowPda, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;
  console.log("Escrow balance:", escrowBal, "ECASH");

  // Step 2: W2 accepts job
  console.log("\n--- Step 2: W2 accepts job ---");
  try {
    const acceptTx = await w2Prog.methods
      .acceptJob()
      .accounts({
        worker: w2.publicKey,
        job: jobPda,
      })
      .rpc();
    await conn.confirmTransaction(acceptTx, "confirmed");
    console.log("[OK] Job accepted:", acceptTx.slice(0, 20) + "...");
    await sleep(1000);
  } catch (e) {
    console.log("[ERROR] acceptJob:", e.message);
    if (e.logs) e.logs.forEach(l => console.log("  ", l));
    return;
  }

  // Step 3: W2 submits work
  console.log("\n--- Step 3: W2 submits work ---");
  const resultHash = Buffer.from("completed_work_hash_98_2_split_test");

  try {
    const submitTx = await w2Prog.methods
      .submitWork(Array.from(resultHash))
      .accounts({
        worker: w2.publicKey,
        job: jobPda,
      })
      .rpc();
    await conn.confirmTransaction(submitTx, "confirmed");
    console.log("[OK] Work submitted:", submitTx.slice(0, 20) + "...");
    await sleep(1000);
  } catch (e) {
    console.log("[ERROR] submitWork:", e.message);
    if (e.logs) e.logs.forEach(l => console.log("  ", l));
    return;
  }

  // Step 4: W1 confirms job
  console.log("\n--- Step 4: W1 confirms job ---");
  try {
    const confirmTx = await w1Prog.methods
      .confirmJob()
      .accounts({
        hirer: w1.publicKey,
        globalState: GLOBAL_STATE,
        job: jobPda,
        jobEscrow: jobEscrowPda,
        mint: MINT,
        workerTokenAccount: w2Ata,
        workerProfile: w2ProfilePda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    await conn.confirmTransaction(confirmTx, "confirmed");
    console.log("[OK] Job confirmed:", confirmTx.slice(0, 20) + "...");
    await sleep(1500);
  } catch (e) {
    console.log("[ERROR] confirmJob:", e.message);
    if (e.logs) e.logs.forEach(l => console.log("  ", l));
    return;
  }

  // ================================================================
  // PART 4: Verification
  // ================================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PART 4: VERIFICATION");
  console.log("=".repeat(60));

  // Get balances after
  const w1BalAfter = Number((await getAccount(conn, w1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;
  const w2BalAfter = Number((await getAccount(conn, w2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;

  console.log("\n--- Balances AFTER ---");
  console.log("W1 (Hirer):", w1BalAfter.toFixed(2), "ECASH");
  console.log("W2 (Worker):", w2BalAfter.toFixed(2), "ECASH");

  // Calculate
  const w1Paid = w1BalBefore - w1BalAfter;
  const w2Received = w2BalAfter - w2BalBefore;
  const burned = w1Paid - w2Received;

  console.log("\n--- Payment Breakdown ---");
  console.log("W1 paid:", w1Paid.toFixed(2), "ECASH");
  console.log("W2 received:", w2Received.toFixed(2), "ECASH (expected: 98)");
  console.log("Burned:", burned.toFixed(2), "ECASH (expected: 2)");

  // Check 98/2 split
  const pass98 = Math.abs(w2Received - 98) < 0.01;
  const pass2 = Math.abs(burned - 2) < 0.01;

  console.log("\n--- Verification Results ---");
  console.log("[" + (pass98 ? "PASS" : "FAIL") + "] Worker received 98% (98 ECASH)");
  console.log("[" + (pass2 ? "PASS" : "FAIL") + "] 2% burned (2 ECASH)");

  // Check jobs_completed_as_worker
  const profileAfter = await w2Prog.account.agentProfile.fetch(w2ProfilePda);
  const jobsCompletedBefore = profileBefore.jobsCompletedAsWorker.toNumber();
  const jobsCompletedAfter = profileAfter.jobsCompletedAsWorker.toNumber();

  console.log("\n--- Profile Update ---");
  console.log("jobs_completed_as_worker before:", jobsCompletedBefore);
  console.log("jobs_completed_as_worker after:", jobsCompletedAfter);

  const passJobsIncremented = jobsCompletedAfter === jobsCompletedBefore + 1;
  console.log("[" + (passJobsIncremented ? "PASS" : "FAIL") + "] jobs_completed_as_worker incremented by 1");

  // Final summary
  console.log("\n" + "=".repeat(60));
  console.log("  FINAL SUMMARY");
  console.log("=".repeat(60));
  console.log("\nAll tests passed:", pass98 && pass2 && passJobsIncremented);
  console.log("W2 solve count:", w2Miner.solveCount.toString());
  console.log("W2 jobs completed as worker:", jobsCompletedAfter);

  // Get updated global state
  const gsFinal = await w1Prog.account.globalState.fetch(GLOBAL_STATE);
  console.log("\nGlobal State:");
  console.log("  Total solved:", gsFinal.totalSolved.toString());
  console.log("  Total jobs created:", gsFinal.totalJobsCreated.toString());
  console.log("  Total jobs completed:", gsFinal.totalJobsCompleted.toString());
  console.log("  Total escrow burned:", Number(gsFinal.totalEscrowBurned) / 1e9, "ECASH");
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
