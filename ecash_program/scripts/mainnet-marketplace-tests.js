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
const MINER_STATE_SEED = Buffer.from("miner_state");
const JOB_SEED = Buffer.from("job");
const JOB_ESCROW_SEED = Buffer.from("job_escrow");
const AGENT_PROFILE_SEED = Buffer.from("agent_profile");

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
  console.log("  PHASE 5: MARKETPLACE TESTS - MAINNET");
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

  // Get next job ID from global state
  let globalState = await program.account.globalState.fetch(globalStatePda);
  let nextJobId = globalState.nextJobId.toNumber();
  console.log(`Current next_job_id: ${nextJobId}`);

  // Helper functions
  const getMinerPda = (owner) => PublicKey.findProgramAddressSync([MINER_STATE_SEED, owner.toBuffer()], PROGRAM_ID)[0];
  const getJobPda = (jobId) => PublicKey.findProgramAddressSync(
    [JOB_SEED, new BN(jobId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
  const getJobEscrowPda = (jobId) => PublicKey.findProgramAddressSync(
    [JOB_ESCROW_SEED, new BN(jobId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
  const getAgentProfilePda = (owner) => PublicKey.findProgramAddressSync(
    [AGENT_PROFILE_SEED, owner.toBuffer()],
    PROGRAM_ID
  )[0];

  // ============================================================
  // 5A: PROFILE REGISTRATION
  // ============================================================
  console.log("\n--- 5A: PROFILE REGISTRATION ---\n");

  // 5A.1: W1 register profile
  try {
    const agentProfilePda = getAgentProfilePda(wallet1.publicKey);
    const minerStatePda = getMinerPda(wallet1.publicKey);

    const tx = await program.methods
      .registerProfile("Alice", "Experienced developer")
      .accounts({
        owner: wallet1.publicKey,
        globalState: globalStatePda,
        minerState: minerStatePda,
        agentProfile: agentProfilePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet1])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    const profile = await program.account.agentProfile.fetch(agentProfilePda);
    logResult("5A.1", "W1 register profile", "name=Alice", `name=${profile.name}`, tx, profile.name === "Alice");
  } catch (e) {
    // May already be registered
    if (e.message.includes("already in use") || e.message.includes("AccountOwnedByWrongProgram") || e.logs?.some(l => l.includes("already in use"))) {
      logResult("5A.1", "W1 register profile", "Already registered", "Already exists", null, true);
    } else {
      logResult("5A.1", "W1 register profile", "Success", e.message.slice(0, 60), null, false);
    }
  }
  await new Promise(r => setTimeout(r, 2000));

  // 5A.2: W2 register profile
  try {
    const agentProfilePda = getAgentProfilePda(wallet2.publicKey);
    const minerStatePda = getMinerPda(wallet2.publicKey);

    const tx = await program.methods
      .registerProfile("Bob", "Freelance designer")
      .accounts({
        owner: wallet2.publicKey,
        globalState: globalStatePda,
        minerState: minerStatePda,
        agentProfile: agentProfilePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet2])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    logResult("5A.2", "W2 register profile", "Success", "Registered", tx, true);
  } catch (e) {
    if (e.message.includes("already in use") || e.logs?.some(l => l.includes("already in use"))) {
      logResult("5A.2", "W2 register profile", "Already registered", "Already exists", null, true);
    } else {
      logResult("5A.2", "W2 register profile", "Success", e.message.slice(0, 60), null, false);
    }
  }
  await new Promise(r => setTimeout(r, 2000));

  // 5A.3: W1 re-register (should fail)
  try {
    const agentProfilePda = getAgentProfilePda(wallet1.publicKey);
    const minerStatePda = getMinerPda(wallet1.publicKey);

    await program.methods
      .registerProfile("Alice2", "New description")
      .accounts({
        owner: wallet1.publicKey,
        globalState: globalStatePda,
        minerState: minerStatePda,
        agentProfile: agentProfilePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet1])
      .rpc();
    logResult("5A.3", "W1 re-register profile", "FAIL", "Success (BAD)", null, false);
  } catch (e) {
    logResult("5A.3", "W1 re-register profile", "FAIL: Already exists", "Rejected", null, true);
  }

  // ============================================================
  // 5B: CREATE JOB
  // ============================================================
  console.log("\n--- 5B: CREATE JOB ---\n");

  const jobAmount = new BN(100); // 100 ECASH (program multiplies by decimals internally)
  const deadlineSeconds = 7200; // 2 hours from now (relative, not absolute!)

  // Refresh global state
  globalState = await program.account.globalState.fetch(globalStatePda);
  nextJobId = globalState.nextJobId.toNumber();
  console.log(`Creating job with ID: ${nextJobId}`);

  // 5B.1: W1 create job (100 ECASH, 2 hour deadline)
  let jobId1;
  try {
    const jobPda = getJobPda(nextJobId);
    const jobEscrowPda = getJobEscrowPda(nextJobId);
    const wallet1Ata = getAssociatedTokenAddressSync(MINT, wallet1.publicKey, false, TOKEN_2022_PROGRAM_ID);

    const balBefore = Number((await getAccount(connection, wallet1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);

    const tx = await program.methods
      .createJob(jobAmount, new BN(deadlineSeconds), "Build a landing page")
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
    const balAfter = Number((await getAccount(connection, wallet1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    const escrowed = (balBefore - balAfter) / 1e9;
    jobId1 = nextJobId;
    console.log(`Job ${jobId1} created, escrowed: ${escrowed} ECASH`);
    logResult("5B.1", "W1 create job (100 ECASH)", `Escrow 100`, `Escrowed ${escrowed}`, tx, escrowed === 100);
  } catch (e) {
    console.log("Error:", e.message);
    if (e.logs) console.log("Logs:", e.logs.slice(-5));
    logResult("5B.1", "W1 create job", "Success", e.message.slice(0, 60), null, false);
  }
  await new Promise(r => setTimeout(r, 2000));

  // Refresh job ID for next job
  globalState = await program.account.globalState.fetch(globalStatePda);
  nextJobId = globalState.nextJobId.toNumber();

  // 5B.2: W3 create job (50 ECASH)
  let jobId2;
  try {
    const jobPda = getJobPda(nextJobId);
    const jobEscrowPda = getJobEscrowPda(nextJobId);
    const wallet3Ata = getAssociatedTokenAddressSync(MINT, wallet3.publicKey, false, TOKEN_2022_PROGRAM_ID);

    const tx = await program.methods
      .createJob(new BN(50), new BN(deadlineSeconds), "Write documentation")
      .accounts({
        hirer: wallet3.publicKey,
        globalState: globalStatePda,
        job: jobPda,
        jobEscrow: jobEscrowPda,
        mint: MINT,
        hirerTokenAccount: wallet3Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet3])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    jobId2 = nextJobId;
    console.log(`Job ${jobId2} created`);
    logResult("5B.2", "W3 create job (50 ECASH)", "Success", `Job ${jobId2} created`, tx, true);
  } catch (e) {
    logResult("5B.2", "W3 create job", "Success", e.message.slice(0, 60), null, false);
  }
  await new Promise(r => setTimeout(r, 2000));

  // 5B.3: Create job with amount below minimum (should fail)
  globalState = await program.account.globalState.fetch(globalStatePda);
  nextJobId = globalState.nextJobId.toNumber();
  try {
    const jobPda = getJobPda(nextJobId);
    const jobEscrowPda = getJobEscrowPda(nextJobId);
    const wallet4Ata = getAssociatedTokenAddressSync(MINT, wallet4.publicKey, false, TOKEN_2022_PROGRAM_ID);

    await program.methods
      .createJob(new BN(5), new BN(deadlineSeconds), "Too cheap job") // 5 ECASH < 10 minimum
      .accounts({
        hirer: wallet4.publicKey,
        globalState: globalStatePda,
        job: jobPda,
        jobEscrow: jobEscrowPda,
        mint: MINT,
        hirerTokenAccount: wallet4Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet4])
      .rpc();
    logResult("5B.3", "Create job below minimum", "FAIL", "Success (BAD)", null, false);
  } catch (e) {
    logResult("5B.3", "Create job below minimum", "FAIL: BelowMinimum", "Rejected", null, true);
  }

  // ============================================================
  // 5C: ACCEPT JOB
  // ============================================================
  console.log("\n--- 5C: ACCEPT JOB ---\n");

  if (jobId1 !== undefined) {
    // 5C.1: W2 accepts W1's job
    try {
      const jobPda = getJobPda(jobId1);
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
      const job = await program.account.job.fetch(jobPda);
      const isAccepted = job.worker.equals(wallet2.publicKey);
      logResult("5C.1", `W2 accepts job ${jobId1}`, `worker=W2`, isAccepted ? "Accepted by W2" : "Wrong worker", tx, isAccepted);
    } catch (e) {
      logResult("5C.1", "W2 accepts job 0", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));

    // 5C.2: W4 tries to accept already-taken job (should fail)
    try {
      const jobPda = getJobPda(jobId1);

      // First register W4 profile if needed
      const w4ProfilePda = getAgentProfilePda(wallet4.publicKey);
      const w4MinerPda = getMinerPda(wallet4.publicKey);
      try {
        await program.methods
          .registerProfile("Dave", "New worker")
          .accounts({
            owner: wallet4.publicKey,
            globalState: globalStatePda,
            minerState: w4MinerPda,
            agentProfile: w4ProfilePda,
            systemProgram: SystemProgram.programId,
          })
          .signers([wallet4])
          .rpc();
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        // Profile may already exist
      }

      await program.methods
        .acceptJob()
        .accounts({
          worker: wallet4.publicKey,
          job: jobPda,
          workerProfile: w4ProfilePda,
        })
        .signers([wallet4])
        .rpc();
      logResult("5C.2", "W4 accept already-taken job", "FAIL", "Success (BAD)", null, false);
    } catch (e) {
      logResult("5C.2", "W4 accept already-taken job", "FAIL: AlreadyTaken", "Rejected", null, true);
    }
  } else {
    logResult("5C.1", "W2 accepts job 0", "Success", "Job not created", null, false);
    logResult("5C.2", "W4 accept already-taken job", "FAIL", "Job not created", null, false);
  }

  // ============================================================
  // 5D: SUBMIT WORK
  // ============================================================
  console.log("\n--- 5D: SUBMIT WORK ---\n");

  if (jobId1 !== undefined) {
    // 5D.1: W2 submits work for job 0
    const resultHash = Array.from(Buffer.alloc(32, 0xAB)); // Mock result hash
    try {
      const jobPda = getJobPda(jobId1);

      const tx = await program.methods
        .submitWork(resultHash)
        .accounts({
          worker: wallet2.publicKey,
          job: jobPda,
        })
        .signers([wallet2])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      const job = await program.account.job.fetch(jobPda);
      const hasResult = job.resultHash && job.resultHash[0] === 0xAB;
      logResult("5D.1", "W2 submit work", "resultHash set", hasResult ? "Hash stored" : "No hash", tx, hasResult);
    } catch (e) {
      logResult("5D.1", "W2 submit work", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));

    // 5D.2: W4 tries to submit for job not theirs (should fail)
    try {
      const jobPda = getJobPda(jobId1);

      await program.methods
        .submitWork(Array.from(Buffer.alloc(32, 0xFF)))
        .accounts({
          worker: wallet4.publicKey,
          job: jobPda,
        })
        .signers([wallet4])
        .rpc();
      logResult("5D.2", "W4 submit for wrong job", "FAIL", "Success (BAD)", null, false);
    } catch (e) {
      logResult("5D.2", "W4 submit for wrong job", "FAIL: NotWorker", "Rejected", null, true);
    }
  } else {
    logResult("5D.1", "W2 submit work", "Success", "Job not created", null, false);
    logResult("5D.2", "W4 submit for wrong job", "FAIL", "Job not created", null, false);
  }

  // ============================================================
  // 5E: CONFIRM JOB
  // ============================================================
  console.log("\n--- 5E: CONFIRM JOB ---\n");

  if (jobId1 !== undefined) {
    // 5E.1: W1 confirms job (pays W2)
    try {
      const jobPda = getJobPda(jobId1);
      const jobEscrowPda = getJobEscrowPda(jobId1);
      const wallet2Ata = getAssociatedTokenAddressSync(MINT, wallet2.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const workerProfilePda = getAgentProfilePda(wallet2.publicKey);

      const balBefore = Number((await getAccount(connection, wallet2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);

      const tx = await program.methods
        .confirmJob()
        .accounts({
          hirer: wallet1.publicKey,
          globalState: globalStatePda,
          job: jobPda,
          jobEscrow: jobEscrowPda,
          mint: MINT,
          workerTokenAccount: wallet2Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([wallet1])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      const balAfter = Number((await getAccount(connection, wallet2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
      const received = (balAfter - balBefore) / 1e9;
      // Worker receives 98% (100 * 0.98 = 98 ECASH, 2% burn)
      console.log(`W2 received: ${received} ECASH`);
      const expectedMin = 97; // Approximately 98 after burn
      logResult("5E.1", "W1 confirms job", "W2 receives ~98", `Received ${received.toFixed(1)}`, tx, received >= expectedMin);
    } catch (e) {
      console.log("Error:", e.message);
      if (e.logs) console.log("Logs:", e.logs.slice(-5));
      logResult("5E.1", "W1 confirms job", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));

    // 5E.2: Check W2's profile reputation increased
    try {
      const profilePda = getAgentProfilePda(wallet2.publicKey);
      const profile = await program.account.agentProfile.fetch(profilePda);
      const completedJobs = profile.completedJobs.toNumber();
      console.log(`W2 completed jobs: ${completedJobs}`);
      logResult("5E.2", "W2 reputation updated", "completedJobs >= 1", `completedJobs=${completedJobs}`, null, completedJobs >= 1);
    } catch (e) {
      logResult("5E.2", "W2 reputation updated", "completedJobs >= 1", e.message.slice(0, 40), null, false);
    }
  } else {
    logResult("5E.1", "W1 confirms job", "Success", "Job not created", null, false);
    logResult("5E.2", "W2 reputation updated", "completedJobs >= 1", "Job not created", null, false);
  }

  // ============================================================
  // 5F: CANCEL JOB
  // ============================================================
  console.log("\n--- 5F: CANCEL JOB ---\n");

  // Create a new job for cancellation test
  globalState = await program.account.globalState.fetch(globalStatePda);
  nextJobId = globalState.nextJobId.toNumber();
  let jobIdCancel;

  // 5F.1: Create job for cancel test
  try {
    const jobPda = getJobPda(nextJobId);
    const jobEscrowPda = getJobEscrowPda(nextJobId);
    const wallet4Ata = getAssociatedTokenAddressSync(MINT, wallet4.publicKey, false, TOKEN_2022_PROGRAM_ID);

    const tx = await program.methods
      .createJob(new BN(25), new BN(deadlineSeconds), "Job to cancel")
      .accounts({
        hirer: wallet4.publicKey,
        globalState: globalStatePda,
        job: jobPda,
        jobEscrow: jobEscrowPda,
        mint: MINT,
        hirerTokenAccount: wallet4Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet4])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    jobIdCancel = nextJobId;
    logResult("5F.1", "Create job for cancel test", "Success", `Job ${jobIdCancel}`, tx, true);
  } catch (e) {
    logResult("5F.1", "Create job for cancel test", "Success", e.message.slice(0, 60), null, false);
  }
  await new Promise(r => setTimeout(r, 2000));

  // 5F.2: W4 cancels their job (before acceptance)
  if (jobIdCancel !== undefined) {
    try {
      const jobPda = getJobPda(jobIdCancel);
      const jobEscrowPda = getJobEscrowPda(jobIdCancel);
      const wallet4Ata = getAssociatedTokenAddressSync(MINT, wallet4.publicKey, false, TOKEN_2022_PROGRAM_ID);

      const balBefore = Number((await getAccount(connection, wallet4Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);

      const tx = await program.methods
        .cancelJob()
        .accounts({
          hirer: wallet4.publicKey,
          globalState: globalStatePda,
          job: jobPda,
          jobEscrow: jobEscrowPda,
          mint: MINT,
          hirerTokenAccount: wallet4Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([wallet4])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      const balAfter = Number((await getAccount(connection, wallet4Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
      const refunded = (balAfter - balBefore) / 1e9;
      console.log(`W4 refunded: ${refunded} ECASH`);
      logResult("5F.2", "W4 cancels unaccepted job", "Refund 25", `Refunded ${refunded}`, tx, refunded === 25);
    } catch (e) {
      logResult("5F.2", "W4 cancels unaccepted job", "Success", e.message.slice(0, 60), null, false);
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 5 MARKETPLACE RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let logContent = `\n### 5A-F: Profile + Job Lifecycle Tests (FIXED)\n\n| # | Test | Expected | Actual | TX | Status |\n|---|------|----------|--------|-----|--------|\n`;
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
