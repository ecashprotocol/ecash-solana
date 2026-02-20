const anchor = require("@coral-xyz/anchor");
const { Program, AnchorProvider, BN } = anchor;
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} = require("@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Constants
const PROGRAM_ID = new PublicKey("7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u");
const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const JOB_SEED = Buffer.from("job");
const JOB_ESCROW_SEED = Buffer.from("job_escrow");
const DISPUTE_SEED = Buffer.from("dispute");
const AGENT_PROFILE_SEED = Buffer.from("agent_profile");
const ARBITRATOR_STATS_SEED = Buffer.from("arbitrator_stats");

// Test results
const results = [];
let passCount = 0;
let failCount = 0;

function logResult(testId, testName, expected, actual, txSig, passed) {
  const status = passed ? "PASS" : "FAIL";
  if (passed) passCount++;
  else failCount++;
  const result = { testId, testName, expected, actual, txSig, status };
  results.push(result);
  console.log(`[${status}] ${testId}: ${testName}`);
  if (txSig) console.log(`       TX: ${txSig}`);
  if (!passed) console.log(`       Expected: ${expected}, Got: ${actual}`);
  return result;
}

async function loadWallet(name) {
  const walletPath = path.join(os.homedir(), `ecash-solana/${name}.json`);
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
}

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 6 + 21A: DISPUTE & ARBITRATOR TESTS - MAINNET");
  console.log("=".repeat(60));

  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const deployer = await loadWallet("deployer");
  const wallet1 = await loadWallet("wallet-1");
  const wallet2 = await loadWallet("wallet-2");
  const wallet3 = await loadWallet("wallet-3");
  const wallet4 = await loadWallet("wallet-4");
  const wallet5 = await loadWallet("wallet-5");

  const idlPath = path.join(__dirname, "../target/idl/ecash_program.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  const provider = new AnchorProvider(connection, new anchor.Wallet(deployer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl, provider);

  const [globalStatePda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);

  // Helper functions
  const getJobPda = (jobId) => PublicKey.findProgramAddressSync(
    [JOB_SEED, new BN(jobId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
  const getJobEscrowPda = (jobId) => PublicKey.findProgramAddressSync(
    [JOB_ESCROW_SEED, new BN(jobId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
  const getDisputePda = (jobId) => PublicKey.findProgramAddressSync(
    [DISPUTE_SEED, new BN(jobId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
  const getAgentProfilePda = (owner) => PublicKey.findProgramAddressSync(
    [AGENT_PROFILE_SEED, owner.toBuffer()],
    PROGRAM_ID
  )[0];
  const getArbitratorStatsPda = (owner) => PublicKey.findProgramAddressSync(
    [ARBITRATOR_STATS_SEED, owner.toBuffer()],
    PROGRAM_ID
  )[0];

  // ============================================================
  // 21A: ARBITRATOR ENROLLMENT
  // ============================================================
  console.log("\n--- 21A: ARBITRATOR ENROLLMENT ---\n");

  // 21A.1: W3 enroll as arbitrator
  try {
    const agentProfilePda = getAgentProfilePda(wallet3.publicKey);
    const arbitratorStatsPda = getArbitratorStatsPda(wallet3.publicKey);

    const tx = await program.methods
      .enrollAsArbitrator()
      .accounts({
        owner: wallet3.publicKey,
        globalState: globalStatePda,
        agentProfile: agentProfilePda,
        arbitratorStats: arbitratorStatsPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet3])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    const stats = await program.account.arbitratorStats.fetch(arbitratorStatsPda);
    const isEnrolled = stats.isActive;
    logResult("21A.1", "W3 enroll as arbitrator", "isActive=true", `isActive=${isEnrolled}`, tx, isEnrolled);
  } catch (e) {
    if (e.message.includes("already in use") || e.message.includes("AlreadyEnrolled")) {
      logResult("21A.1", "W3 enroll as arbitrator", "Already enrolled", "Already enrolled", null, true);
    } else {
      console.log("Error:", e.message);
      logResult("21A.1", "W3 enroll as arbitrator", "Success", e.message.slice(0, 60), null, false);
    }
  }
  await new Promise(r => setTimeout(r, 2000));

  // 21A.2: W3 try to enroll again (should fail)
  try {
    const agentProfilePda = getAgentProfilePda(wallet3.publicKey);
    const arbitratorStatsPda = getArbitratorStatsPda(wallet3.publicKey);

    await program.methods
      .enrollAsArbitrator()
      .accounts({
        owner: wallet3.publicKey,
        globalState: globalStatePda,
        agentProfile: agentProfilePda,
        arbitratorStats: arbitratorStatsPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet3])
      .rpc();
    logResult("21A.2", "W3 enroll again", "FAIL: AlreadyEnrolled", "Success (BAD)", null, false);
  } catch (e) {
    logResult("21A.2", "W3 enroll again", "FAIL: AlreadyEnrolled", "Rejected", null, true);
  }

  // ============================================================
  // 6A: CREATE DISPUTED JOB
  // ============================================================
  console.log("\n--- 6A: CREATE DISPUTED JOB ---\n");

  // Get next job ID
  let globalState = await program.account.globalState.fetch(globalStatePda);
  let nextJobId = globalState.nextJobId.toNumber();
  console.log(`Creating dispute test job with ID: ${nextJobId}`);

  const deadlineSeconds = 7200; // 2 hours
  let disputeJobId;

  // 6A.1: W1 creates job for dispute testing
  try {
    const jobPda = getJobPda(nextJobId);
    const jobEscrowPda = getJobEscrowPda(nextJobId);
    const wallet1Ata = getAssociatedTokenAddressSync(MINT, wallet1.publicKey, false, TOKEN_2022_PROGRAM_ID);

    const tx = await program.methods
      .createJob(new BN(50), new BN(deadlineSeconds), "Job for dispute test")
      .accounts({
        hirer: wallet1.publicKey,
        globalState: globalStatePda,
        job: jobPda,
        jobEscrow: jobEscrowPda,
        mint: MINT,
        hirerTokenAccount: wallet1Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet1])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    disputeJobId = nextJobId;
    console.log(`Dispute test job created: ${disputeJobId}`);
    logResult("6A.1", "Create job for dispute test", "Success", `Job ${disputeJobId}`, tx, true);
  } catch (e) {
    logResult("6A.1", "Create job for dispute test", "Success", e.message.slice(0, 60), null, false);
  }
  await new Promise(r => setTimeout(r, 2000));

  // 6A.2: W2 accepts job
  if (disputeJobId !== undefined) {
    try {
      const jobPda = getJobPda(disputeJobId);
      const workerProfilePda = getAgentProfilePda(wallet2.publicKey);

      const tx = await program.methods
        .acceptJob()
        .accounts({
          worker: wallet2.publicKey,
          job: jobPda,
          workerProfile: workerProfilePda,
        })
        .signers([wallet2])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      logResult("6A.2", "W2 accepts dispute job", "Success", "Accepted", tx, true);
    } catch (e) {
      logResult("6A.2", "W2 accepts dispute job", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));

    // 6A.3: W2 submits work
    try {
      const jobPda = getJobPda(disputeJobId);
      const resultHash = Array.from(Buffer.alloc(32, 0xCD));

      const tx = await program.methods
        .submitWork(resultHash)
        .accounts({
          worker: wallet2.publicKey,
          job: jobPda,
        })
        .signers([wallet2])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      logResult("6A.3", "W2 submits work", "Success", "Submitted", tx, true);
    } catch (e) {
      logResult("6A.3", "W2 submits work", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // ============================================================
  // 6B: FILE DISPUTE
  // ============================================================
  console.log("\n--- 6B: FILE DISPUTE ---\n");

  if (disputeJobId !== undefined) {
    // 6B.1: W1 files dispute
    try {
      const jobPda = getJobPda(disputeJobId);
      const disputePda = getDisputePda(disputeJobId);
      const jobEscrowPda = getJobEscrowPda(disputeJobId);
      const wallet1Ata = getAssociatedTokenAddressSync(MINT, wallet1.publicKey, false, TOKEN_2022_PROGRAM_ID);

      const tx = await program.methods
        .fileDispute()
        .accounts({
          disputer: wallet1.publicKey,
          globalState: globalStatePda,
          job: jobPda,
          dispute: disputePda,
          jobEscrow: jobEscrowPda,
          mint: MINT,
          disputerTokenAccount: wallet1Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet1])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      const dispute = await program.account.dispute.fetch(disputePda);
      console.log(`Dispute filed, arbitrator count: ${dispute.arbitratorCount}`);
      logResult("6B.1", "W1 files dispute", "Dispute created", `Created, arb_count=${dispute.arbitratorCount}`, tx, true);
    } catch (e) {
      console.log("Error filing dispute:", e.message);
      if (e.logs) console.log("Logs:", e.logs.slice(-5));
      logResult("6B.1", "W1 files dispute", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));

    // 6B.2: W3 files dispute again (should fail - already disputed)
    try {
      const jobPda = getJobPda(disputeJobId);
      const disputePda = getDisputePda(disputeJobId);
      const jobEscrowPda = getJobEscrowPda(disputeJobId);
      const wallet3Ata = getAssociatedTokenAddressSync(MINT, wallet3.publicKey, false, TOKEN_2022_PROGRAM_ID);

      await program.methods
        .fileDispute()
        .accounts({
          disputer: wallet3.publicKey,
          globalState: globalStatePda,
          job: jobPda,
          dispute: disputePda,
          jobEscrow: jobEscrowPda,
          mint: MINT,
          disputerTokenAccount: wallet3Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet3])
        .rpc();
      logResult("6B.2", "W3 file duplicate dispute", "FAIL", "Success (BAD)", null, false);
    } catch (e) {
      logResult("6B.2", "W3 file duplicate dispute", "FAIL: AlreadyDisputed", "Rejected", null, true);
    }

    // ============================================================
    // 6C: ARBITRATOR ASSIGNMENT
    // ============================================================
    console.log("\n--- 6C: ARBITRATOR ASSIGNMENT ---\n");

    // 6C.1: W3 assigns self as arbitrator
    try {
      const jobPda = getJobPda(disputeJobId);
      const disputePda = getDisputePda(disputeJobId);
      const jobEscrowPda = getJobEscrowPda(disputeJobId);
      const arbitratorStatsPda = getArbitratorStatsPda(wallet3.publicKey);
      const wallet3Ata = getAssociatedTokenAddressSync(MINT, wallet3.publicKey, false, TOKEN_2022_PROGRAM_ID);

      const tx = await program.methods
        .assignArbitrator()
        .accounts({
          arbitrator: wallet3.publicKey,
          globalState: globalStatePda,
          job: jobPda,
          dispute: disputePda,
          arbitratorStats: arbitratorStatsPda,
          jobEscrow: jobEscrowPda,
          mint: MINT,
          arbitratorTokenAccount: wallet3Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([wallet3])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      const dispute = await program.account.dispute.fetch(disputePda);
      const isAssigned = dispute.arbitrator1.equals(wallet3.publicKey) ||
                        dispute.arbitrator2.equals(wallet3.publicKey) ||
                        dispute.arbitrator3.equals(wallet3.publicKey);
      logResult("6C.1", "W3 assigned as arbitrator", "W3 in arb list", isAssigned ? "Assigned" : "Not assigned", tx, isAssigned);
    } catch (e) {
      console.log("Error:", e.message);
      if (e.logs) console.log("Logs:", e.logs.slice(-5));
      logResult("6C.1", "W3 assigned as arbitrator", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));

    // ============================================================
    // 6D: VOTE ON DISPUTE
    // ============================================================
    console.log("\n--- 6D: VOTE ON DISPUTE ---\n");

    // 6D.1: W3 votes on dispute (HirerWins = 0, WorkerWins = 1)
    try {
      const disputePda = getDisputePda(disputeJobId);

      // Vote enum: { HirerWins: {}, WorkerWins: {} }
      const tx = await program.methods
        .voteOnDispute({ hirerWins: {} })
        .accounts({
          arbitrator: wallet3.publicKey,
          dispute: disputePda,
        })
        .signers([wallet3])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      const dispute = await program.account.dispute.fetch(disputePda);
      console.log(`Votes received: ${dispute.votesReceived}`);
      logResult("6D.1", "W3 votes HirerWins", "votesReceived >= 1", `votes=${dispute.votesReceived}`, tx, dispute.votesReceived >= 1);
    } catch (e) {
      console.log("Error:", e.message);
      if (e.logs) console.log("Logs:", e.logs.slice(-5));
      logResult("6D.1", "W3 votes HirerWins", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));

    // 6D.2: W3 votes again (should fail - already voted)
    try {
      const disputePda = getDisputePda(disputeJobId);

      await program.methods
        .voteOnDispute({ workerWins: {} })
        .accounts({
          arbitrator: wallet3.publicKey,
          dispute: disputePda,
        })
        .signers([wallet3])
        .rpc();
      logResult("6D.2", "W3 double vote", "FAIL", "Success (BAD)", null, false);
    } catch (e) {
      logResult("6D.2", "W3 double vote", "FAIL: AlreadyVoted", "Rejected", null, true);
    }

    // 6D.3: W4 tries to vote (not an arbitrator)
    try {
      const disputePda = getDisputePda(disputeJobId);

      await program.methods
        .voteOnDispute({ hirerWins: {} })
        .accounts({
          arbitrator: wallet4.publicKey,
          dispute: disputePda,
        })
        .signers([wallet4])
        .rpc();
      logResult("6D.3", "W4 vote (not arb)", "FAIL", "Success (BAD)", null, false);
    } catch (e) {
      logResult("6D.3", "W4 vote (not arb)", "FAIL: NotArbitrator", "Rejected", null, true);
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 6 + 21A RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let logContent = `\n---\n\n## PHASE 6: Dispute Tests + PHASE 21A: Arbitrator Tests\n\n| # | Test | Expected | Actual | TX | Status |\n|---|------|----------|--------|-----|--------|\n`;
  for (const r of results) {
    const txLink = r.txSig ? `[${r.txSig.slice(0,8)}...](https://solscan.io/tx/${r.txSig})` : "N/A";
    logContent += `| ${r.testId} | ${r.testName} | ${r.expected} | ${r.actual.slice(0,30)} | ${txLink} | ${r.status} |\n`;
  }
  logContent += `\n**Summary**: ${passCount}/${results.length} passed\n`;
  fs.appendFileSync(logPath, logContent);
  console.log("\nResults appended to DEPLOY-TEST-LOG.md");
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
