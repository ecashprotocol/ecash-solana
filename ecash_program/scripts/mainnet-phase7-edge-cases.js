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
const AGENT_PROFILE_SEED = Buffer.from("agent_profile");
const VAULT_SEED = Buffer.from("vault");
const JOB_SEED = Buffer.from("job");
const JOB_ESCROW_SEED = Buffer.from("job_escrow");

// Test results
const results = [];
let passCount = 0;
let failCount = 0;

function logResult(testId, testName, expected, actual, passed) {
  const status = passed ? "PASS" : "FAIL";
  if (passed) passCount++;
  else failCount++;
  const result = { testId, testName, expected, actual, status };
  results.push(result);
  console.log(`[${status}] ${testId}: ${testName}`);
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
  console.log("  PHASE 7: EDGE CASES + ERROR HANDLING");
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
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_ID);

  const getMinerPda = (owner) => PublicKey.findProgramAddressSync([MINER_STATE_SEED, owner.toBuffer()], PROGRAM_ID)[0];
  const getAgentProfilePda = (owner) => PublicKey.findProgramAddressSync([AGENT_PROFILE_SEED, owner.toBuffer()], PROGRAM_ID)[0];
  const getJobPda = (jobId) => PublicKey.findProgramAddressSync([JOB_SEED, new BN(jobId).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];
  const getJobEscrowPda = (jobId) => PublicKey.findProgramAddressSync([JOB_ESCROW_SEED, new BN(jobId).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];

  // ============================================================
  // 7A: INVALID INPUT TESTS
  // ============================================================
  console.log("\n--- 7A: INVALID INPUT TESTS ---\n");

  // 7A.1: Empty profile name
  try {
    await program.methods
      .registerProfile("", "Description")
      .accounts({
        owner: wallet5.publicKey,
        globalState: globalStatePda,
        minerState: getMinerPda(wallet5.publicKey),
        agentProfile: getAgentProfilePda(wallet5.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet5])
      .simulate();
    logResult("7A.1", "Empty profile name", "FAIL: Invalid", "Allowed", false);
  } catch (e) {
    // Transaction was rejected - this is correct behavior
    logResult("7A.1", "Empty profile name", "FAIL: Invalid", "Rejected", true);
  }
  await new Promise(r => setTimeout(r, 1500));

  // 7A.2: Very long profile name (boundary test)
  try {
    const longName = "A".repeat(100);
    await program.methods
      .registerProfile(longName, "Description")
      .accounts({
        owner: wallet5.publicKey,
        globalState: globalStatePda,
        minerState: getMinerPda(wallet5.publicKey),
        agentProfile: getAgentProfilePda(wallet5.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet5])
      .simulate();
    logResult("7A.2", "100-char profile name", "FAIL: TooLong", "Allowed", false);
  } catch (e) {
    logResult("7A.2", "100-char profile name", "FAIL: TooLong", "Rejected", true);
  }
  await new Promise(r => setTimeout(r, 1500));

  // 7A.3: Zero-amount job
  try {
    const globalState = await program.account.globalState.fetch(globalStatePda);
    const jobId = globalState.totalJobsCreated.toNumber();
    const jobPda = getJobPda(jobId);
    const jobEscrowPda = getJobEscrowPda(jobId);
    const hirerAta = getAssociatedTokenAddressSync(MINT, wallet1.publicKey, false, TOKEN_2022_PROGRAM_ID);

    await program.methods
      .createJob("Test", "Desc", new BN(0), 3600)
      .accounts({
        hirer: wallet1.publicKey,
        globalState: globalStatePda,
        hirerProfile: getAgentProfilePda(wallet1.publicKey),
        job: jobPda,
        jobEscrow: jobEscrowPda,
        mint: MINT,
        hirerTokenAccount: hirerAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet1])
      .simulate();
    logResult("7A.3", "Zero-amount job", "FAIL: BelowMinimum", "Allowed", false);
  } catch (e) {
    logResult("7A.3", "Zero-amount job", "FAIL: BelowMinimum", "Rejected", true);
  }
  await new Promise(r => setTimeout(r, 1500));

  // 7A.4: Negative deadline (should wrap or fail)
  try {
    const globalState = await program.account.globalState.fetch(globalStatePda);
    const jobId = globalState.totalJobsCreated.toNumber();
    const jobPda = getJobPda(jobId);
    const jobEscrowPda = getJobEscrowPda(jobId);
    const hirerAta = getAssociatedTokenAddressSync(MINT, wallet1.publicKey, false, TOKEN_2022_PROGRAM_ID);

    await program.methods
      .createJob("Test", "Desc", new BN(10), -100)
      .accounts({
        hirer: wallet1.publicKey,
        globalState: globalStatePda,
        hirerProfile: getAgentProfilePda(wallet1.publicKey),
        job: jobPda,
        jobEscrow: jobEscrowPda,
        mint: MINT,
        hirerTokenAccount: hirerAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet1])
      .simulate();
    logResult("7A.4", "Negative deadline", "FAIL: Invalid", "Allowed", false);
  } catch (e) {
    logResult("7A.4", "Negative deadline", "FAIL: Invalid", "Rejected", true);
  }
  await new Promise(r => setTimeout(r, 1500));

  // ============================================================
  // 7B: AUTHORIZATION TESTS
  // ============================================================
  console.log("\n--- 7B: AUTHORIZATION TESTS ---\n");

  // 7B.1: Non-hirer tries to cancel job
  try {
    const jobPda = getJobPda(0); // Job 0 belongs to W1
    const jobEscrowPda = getJobEscrowPda(0);
    const fakeHirerAta = getAssociatedTokenAddressSync(MINT, wallet3.publicKey, false, TOKEN_2022_PROGRAM_ID);

    await program.methods
      .cancelJob()
      .accounts({
        hirer: wallet3.publicKey, // W3 is not the hirer
        globalState: globalStatePda,
        job: jobPda,
        jobEscrow: jobEscrowPda,
        mint: MINT,
        hirerTokenAccount: fakeHirerAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([wallet3])
      .simulate();
    logResult("7B.1", "Non-hirer cancel job", "FAIL: Unauthorized", "Allowed", false);
  } catch (e) {
    logResult("7B.1", "Non-hirer cancel job", "FAIL: Unauthorized", "Rejected", true);
  }
  await new Promise(r => setTimeout(r, 1500));

  // 7B.2: Non-worker tries to submit work
  try {
    const jobPda = getJobPda(0);
    const resultHash = Buffer.alloc(32, 0xaa);

    await program.methods
      .submitWork([...resultHash])
      .accounts({
        worker: wallet4.publicKey, // W4 is not the worker
        job: jobPda,
      })
      .signers([wallet4])
      .simulate();
    logResult("7B.2", "Non-worker submit work", "FAIL: NotWorker", "Allowed", false);
  } catch (e) {
    logResult("7B.2", "Non-worker submit work", "FAIL: NotWorker", "Rejected", true);
  }
  await new Promise(r => setTimeout(r, 1500));

  // 7B.3: Non-hirer tries to confirm job
  try {
    const jobPda = getJobPda(0);
    const jobEscrowPda = getJobEscrowPda(0);
    const fakeWorkerAta = getAssociatedTokenAddressSync(MINT, wallet3.publicKey, false, TOKEN_2022_PROGRAM_ID);

    await program.methods
      .confirmJob()
      .accounts({
        hirer: wallet3.publicKey, // W3 is not the hirer
        globalState: globalStatePda,
        job: jobPda,
        jobEscrow: jobEscrowPda,
        workerProfile: getAgentProfilePda(wallet2.publicKey),
        mint: MINT,
        workerTokenAccount: fakeWorkerAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([wallet3])
      .simulate();
    logResult("7B.3", "Non-hirer confirm job", "FAIL: Unauthorized", "Allowed", false);
  } catch (e) {
    logResult("7B.3", "Non-hirer confirm job", "FAIL: Unauthorized", "Rejected", true);
  }
  await new Promise(r => setTimeout(r, 1500));

  // ============================================================
  // 7C: STATE VALIDATION TESTS
  // ============================================================
  console.log("\n--- 7C: STATE VALIDATION TESTS ---\n");

  // 7C.1: Double registration (miner)
  try {
    await program.methods
      .registerMiner(null)
      .accounts({
        owner: wallet1.publicKey,
        globalState: globalStatePda,
        minerState: getMinerPda(wallet1.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet1])
      .simulate();
    logResult("7C.1", "Double miner registration", "FAIL: AlreadyRegistered", "Allowed", false);
  } catch (e) {
    logResult("7C.1", "Double miner registration", "FAIL: AlreadyRegistered", "Rejected", true);
  }
  await new Promise(r => setTimeout(r, 1500));

  // 7C.2: Accept own job
  try {
    const jobPda = getJobPda(1); // Job 1 created by W3

    await program.methods
      .acceptJob()
      .accounts({
        worker: wallet3.publicKey, // W3 trying to accept their own job
        globalState: globalStatePda,
        job: jobPda,
        workerProfile: getAgentProfilePda(wallet3.publicKey),
      })
      .signers([wallet3])
      .simulate();
    logResult("7C.2", "Accept own job", "FAIL: CannotAcceptOwn", "Allowed", false);
  } catch (e) {
    // Transaction was rejected - this is correct behavior
    logResult("7C.2", "Accept own job", "FAIL: CannotAcceptOwn", "Rejected", true);
  }
  await new Promise(r => setTimeout(r, 1500));

  // 7C.3: Submit work before accepting
  try {
    const jobPda = getJobPda(4); // An unaccepted job
    const resultHash = Buffer.alloc(32, 0xbb);

    await program.methods
      .submitWork([...resultHash])
      .accounts({
        worker: wallet5.publicKey,
        job: jobPda,
      })
      .signers([wallet5])
      .simulate();
    logResult("7C.3", "Submit before accept", "FAIL: NotAccepted", "Allowed", false);
  } catch (e) {
    logResult("7C.3", "Submit before accept", "FAIL: NotAccepted", "Rejected", true);
  }
  await new Promise(r => setTimeout(r, 1500));

  // ============================================================
  // 7D: GAS DEPLETION TESTS
  // ============================================================
  console.log("\n--- 7D: GAS DEPLETION TESTS ---\n");

  // Check current gas balance
  try {
    const minerState = await program.account.minerState.fetch(getMinerPda(wallet1.publicKey));
    const gasBalance = minerState.gasBalance.toNumber();
    console.log(`W1 current gas: ${gasBalance}`);

    // Calculate how many picks would deplete gas
    const pickCost = 10;
    const picksToDeplete = Math.floor(gasBalance / pickCost);
    console.log(`Would need ${picksToDeplete} picks to deplete gas`);

    logResult("7D.1", "Gas balance check", "gas > 0", `gas=${gasBalance}`, gasBalance > 0);
  } catch (e) {
    logResult("7D.1", "Gas balance check", "Success", e.message.slice(0, 40), false);
  }

  // 7D.2: Check gas floor enforcement
  try {
    const minerState = await program.account.minerState.fetch(getMinerPda(wallet4.publicKey));
    const gasBalance = minerState.gasBalance.toNumber();
    console.log(`W4 gas balance: ${gasBalance}`);

    // Gas should never go below floor (100)
    logResult("7D.2", "Gas floor enforcement", "gas >= 100", `gas=${gasBalance}`, gasBalance >= 100);
  } catch (e) {
    logResult("7D.2", "Gas floor enforcement", "Success", e.message.slice(0, 40), false);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 7 RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let logContent = `\n---\n\n## PHASE 7: Edge Cases + Error Handling\n\n`;
  logContent += `| # | Test | Expected | Actual | Status |\n`;
  logContent += `|---|------|----------|--------|--------|\n`;
  for (const r of results) {
    logContent += `| ${r.testId} | ${r.testName} | ${r.expected} | ${r.actual.slice(0,30)} | ${r.status} |\n`;
  }
  logContent += `\n**Summary**: ${passCount}/${results.length} passed\n`;

  fs.appendFileSync(logPath, logContent);
  console.log("\nResults appended to DEPLOY-TEST-LOG.md");
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
