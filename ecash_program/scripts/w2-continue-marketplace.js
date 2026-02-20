// Continue marketplace flow from submitWork
const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROGRAM_ID = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
const MINT = new PublicKey("7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7");
const GLOBAL_STATE = new PublicKey("ELXyB21ZTJiQUHf3pu4W95AiYJ14EDByCqX2JzPZtZqS");

const MINER_STATE_SEED = Buffer.from("miner_state");
const AGENT_PROFILE_SEED = Buffer.from("agent_profile");
const JOB_SEED = Buffer.from("job");
const JOB_ESCROW_SEED = Buffer.from("job_escrow");

const loadWallet = (n) => Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), `ecash-solana/${n}.json`))))
);

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log("============================================================");
  console.log("  CONTINUE: MARKETPLACE FLOW FROM SUBMIT_WORK");
  console.log("============================================================\n");

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const w1 = loadWallet("wallet-1");
  const w2 = loadWallet("wallet-2");

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  idl.address = PROGRAM_ID.toString();

  const w1Provider = new anchor.AnchorProvider(conn, new anchor.Wallet(w1), { commitment: "confirmed" });
  const w2Provider = new anchor.AnchorProvider(conn, new anchor.Wallet(w2), { commitment: "confirmed" });
  const w1Prog = new anchor.Program(idl, w1Provider);
  const w2Prog = new anchor.Program(idl, w2Provider);

  // PDAs - Job 3 (the one we just created)
  const jobId = new BN(3);
  const [jobPda] = PublicKey.findProgramAddressSync([JOB_SEED, jobId.toArrayLike(Buffer, "le", 8)], PROGRAM_ID);
  const [jobEscrowPda] = PublicKey.findProgramAddressSync([JOB_ESCROW_SEED, jobId.toArrayLike(Buffer, "le", 8)], PROGRAM_ID);
  const w2ProfilePda = PublicKey.findProgramAddressSync([AGENT_PROFILE_SEED, w2.publicKey.toBuffer()], PROGRAM_ID)[0];
  const w2Ata = getAssociatedTokenAddressSync(MINT, w2.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const w1Ata = getAssociatedTokenAddressSync(MINT, w1.publicKey, false, TOKEN_2022_PROGRAM_ID);

  console.log("Job PDA:", jobPda.toString());
  console.log("W2 Profile PDA:", w2ProfilePda.toString());

  // Check job status
  const job = await w1Prog.account.job.fetch(jobPda);
  console.log("\nJob Status:", Object.keys(job.status)[0]);
  console.log("Job Worker:", job.worker.toString());

  // Get profile before for comparison
  const profileBefore = await w2Prog.account.agentProfile.fetch(w2ProfilePda);
  console.log("\nW2 jobs_completed_as_worker (before):", profileBefore.jobsCompletedAsWorker.toString());

  // Get balances before
  const w1BalBefore = Number((await getAccount(conn, w1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;
  const w2BalBefore = Number((await getAccount(conn, w2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;

  console.log("\n--- Balances BEFORE ---");
  console.log("W1 (Hirer):", w1BalBefore.toFixed(2), "ECASH");
  console.log("W2 (Worker):", w2BalBefore.toFixed(2), "ECASH");

  // Step 3: W2 submits work (if not already)
  if (Object.keys(job.status)[0] === "accepted") {
    console.log("\n--- Step 3: W2 submits work ---");
    // Use Buffer directly for bytes type (max 32 bytes)
    const resultHash = Buffer.from("work_done_98_2_split_verified_ok");

    try {
      const submitTx = await w2Prog.methods
        .submitWork(resultHash)
        .accounts({
          worker: w2.publicKey,
          job: jobPda,
        })
        .rpc();
      await conn.confirmTransaction(submitTx, "confirmed");
      console.log("[OK] Work submitted:", submitTx.slice(0, 20) + "...");
      await sleep(1500);
    } catch (e) {
      console.log("[ERROR] submitWork:", e.message);
      if (e.logs) e.logs.forEach(l => console.log("  ", l));
      return;
    }
  } else {
    console.log("\n--- Step 3: Work already submitted ---");
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
    console.log("[OK] Job confirmed:", confirmTx);
    await sleep(1500);
  } catch (e) {
    console.log("[ERROR] confirmJob:", e.message);
    if (e.logs) e.logs.forEach(l => console.log("  ", l));
    return;
  }

  // ================================================================
  // VERIFICATION
  // ================================================================
  console.log("\n" + "=".repeat(60));
  console.log("  VERIFICATION");
  console.log("=".repeat(60));

  // Get balances after
  const w1BalAfter = Number((await getAccount(conn, w1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;
  const w2BalAfter = Number((await getAccount(conn, w2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;

  console.log("\n--- Balances AFTER ---");
  console.log("W1 (Hirer):", w1BalAfter.toFixed(2), "ECASH");
  console.log("W2 (Worker):", w2BalAfter.toFixed(2), "ECASH");

  // Calculate changes (note: W1 already paid when creating job, so w1BalBefore is after that)
  const w2Received = w2BalAfter - w2BalBefore;

  console.log("\n--- Payment Analysis ---");
  console.log("W2 received from escrow:", w2Received.toFixed(2), "ECASH (expected: 98)");

  // The escrow had 100 ECASH, worker gets 98, 2 burned
  const pass98 = Math.abs(w2Received - 98) < 0.01;

  console.log("\n--- Verification Results ---");
  console.log("[" + (pass98 ? "PASS" : "FAIL") + "] Worker received 98 ECASH (98% of 100)");

  // Check jobs_completed_as_worker increment
  const profileAfter = await w2Prog.account.agentProfile.fetch(w2ProfilePda);
  const jobsCompletedBefore = profileBefore.jobsCompletedAsWorker.toNumber();
  const jobsCompletedAfter = profileAfter.jobsCompletedAsWorker.toNumber();

  console.log("\n--- Profile Update ---");
  console.log("jobs_completed_as_worker before:", jobsCompletedBefore);
  console.log("jobs_completed_as_worker after:", jobsCompletedAfter);

  const passJobsIncremented = jobsCompletedAfter === jobsCompletedBefore + 1;
  console.log("[" + (passJobsIncremented ? "PASS" : "FAIL") + "] jobs_completed_as_worker incremented");

  // Check global state
  const gsFinal = await w1Prog.account.globalState.fetch(GLOBAL_STATE);
  console.log("\n--- Global State ---");
  console.log("Total jobs completed:", gsFinal.totalJobsCompleted.toString());
  console.log("Total escrow burned:", Number(gsFinal.totalEscrowBurned) / 1e9, "ECASH");

  // Final job state
  const jobFinal = await w1Prog.account.job.fetch(jobPda);
  console.log("\n--- Job Final State ---");
  console.log("Status:", Object.keys(jobFinal.status)[0]);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("  FINAL SUMMARY");
  console.log("=".repeat(60));
  console.log("\n[" + (pass98 && passJobsIncremented ? "ALL PASS" : "SOME FAILED") + "]");
  console.log("  - 98/2 payment split: " + (pass98 ? "VERIFIED" : "FAILED"));
  console.log("  - Profile jobs counter: " + (passJobsIncremented ? "INCREMENTED" : "FAILED"));
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
