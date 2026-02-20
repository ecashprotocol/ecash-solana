// Test 3: Marketplace - Create job, accept, submit, confirm
const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROGRAM_ID = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
const MINT = new PublicKey("7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7");
const GLOBAL_STATE = new PublicKey("ELXyB21ZTJiQUHf3pu4W95AiYJ14EDByCqX2JzPZtZqS");

const JOB_SEED = Buffer.from("job");
const JOB_ESCROW_SEED = Buffer.from("job_escrow");
const MINER_STATE_SEED = Buffer.from("miner_state");
const PROFILE_SEED = Buffer.from("agent_profile");

const loadWallet = (n) => Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), `ecash-solana/${n}.json`))))
);

async function main() {
  console.log("============================================================");
  console.log("  TEST 3: MARKETPLACE - JOB FLOW");
  console.log("============================================================");

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const w1 = loadWallet("wallet-1"); // Hirer
  const w2 = loadWallet("wallet-2"); // Worker

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  idl.address = PROGRAM_ID.toString();

  // Get global state to find next job ID
  const deployerProvider = new anchor.AnchorProvider(conn, new anchor.Wallet(loadWallet("deployer")), { commitment: "confirmed" });
  const readProg = new anchor.Program(idl, deployerProvider);

  // Read global state raw to get nextJobId
  const gsInfo = await conn.getAccountInfo(GLOBAL_STATE);
  // GlobalState layout after discriminator (8):
  // authority (32), mint (32), merkle_root (32), total_solved (8), current_batch (8), batch_solve_count (8),
  // cooldown_end (8), total_burned (8), is_renounced (1), bump (1), mint_bump (1), vault_bump (1),
  // total_jobs_created (8), total_jobs_completed (8), total_disputes (8), total_escrow_burned (8), next_job_id (8)
  // Offset: 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 1 + 1 + 8 + 8 + 8 + 8 = 180
  const nextJobId = gsInfo.data.readBigUInt64LE(180);
  console.log("\nNext Job ID:", nextJobId.toString());

  const jobId = nextJobId;
  const [jobPda] = PublicKey.findProgramAddressSync([JOB_SEED, new BN(jobId.toString()).toArrayLike(Buffer, "le", 8)], PROGRAM_ID);
  const [jobEscrowPda] = PublicKey.findProgramAddressSync([JOB_ESCROW_SEED, new BN(jobId.toString()).toArrayLike(Buffer, "le", 8)], PROGRAM_ID);

  console.log("Job PDA:", jobPda.toString());
  console.log("Job Escrow PDA:", jobEscrowPda.toString());

  // W1 and W2 ATAs
  const w1Ata = getAssociatedTokenAddressSync(MINT, w1.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const w2Ata = getAssociatedTokenAddressSync(MINT, w2.publicKey, false, TOKEN_2022_PROGRAM_ID);

  // W2 Profile and MinerState PDAs
  const w2MinerPda = PublicKey.findProgramAddressSync([MINER_STATE_SEED, w2.publicKey.toBuffer()], PROGRAM_ID)[0];
  const w2ProfilePda = PublicKey.findProgramAddressSync([PROFILE_SEED, w2.publicKey.toBuffer()], PROGRAM_ID)[0];

  // Get balances before
  const w1BalBefore = Number((await getAccount(conn, w1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;
  const w2BalBefore = Number((await getAccount(conn, w2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;

  console.log("\n--- Balances BEFORE ---");
  console.log("W1 (Hirer):", w1BalBefore, "ECASH");
  console.log("W2 (Worker):", w2BalBefore, "ECASH");

  // Step 1: W1 creates job (100 ECASH, 24h deadline)
  console.log("\n--- Step 1: W1 creates job ---");
  const jobAmount = new BN(100); // 100 ECASH (whole tokens, contract applies decimals)
  const deadline = new BN(86400); // 24 hours (duration in seconds, not absolute timestamp)

  const w1Provider = new anchor.AnchorProvider(conn, new anchor.Wallet(w1), { commitment: "confirmed" });
  const w1Prog = new anchor.Program(idl, w1Provider);

  try {
    const createTx = await w1Prog.methods
      .createJob(jobAmount, deadline, "Test job for marketplace flow")
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
  } catch (e) {
    console.log("[ERROR] createJob:", e.message);
    if (e.simulationResponse) e.simulationResponse.logs.forEach(l => console.log(" ", l));
    return;
  }

  await new Promise(r => setTimeout(r, 1500));

  // Check escrow balance
  const escrowBal = Number((await getAccount(conn, jobEscrowPda, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;
  console.log("Escrow balance:", escrowBal, "ECASH");

  // Step 2: W2 needs a profile first
  console.log("\n--- Step 2a: Register W2 profile (if needed) ---");
  const w2Provider = new anchor.AnchorProvider(conn, new anchor.Wallet(w2), { commitment: "confirmed" });
  const w2Prog = new anchor.Program(idl, w2Provider);

  // Check if profile exists
  let profileExists = false;
  try {
    await conn.getAccountInfo(w2ProfilePda);
    const info = await conn.getAccountInfo(w2ProfilePda);
    if (info && info.data.length > 0) {
      profileExists = true;
      console.log("W2 profile already exists");
    }
  } catch {}

  if (!profileExists) {
    try {
      const profileTx = await w2Prog.methods
        .registerProfile("Worker2", "Test worker profile")
        .accounts({
          owner: w2.publicKey,
          globalState: GLOBAL_STATE,
          minerState: w2MinerPda,
          agentProfile: w2ProfilePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await conn.confirmTransaction(profileTx, "confirmed");
      console.log("[OK] W2 profile registered:", profileTx.slice(0, 20) + "...");
    } catch (e) {
      console.log("[ERROR] registerProfile:", e.message);
      // May already exist or error
    }
  }

  await new Promise(r => setTimeout(r, 1000));

  // Step 2b: W2 accepts job
  console.log("\n--- Step 2b: W2 accepts job ---");
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
  } catch (e) {
    console.log("[ERROR] acceptJob:", e.message);
    if (e.simulationResponse) e.simulationResponse.logs.forEach(l => console.log(" ", l));
    return;
  }

  await new Promise(r => setTimeout(r, 1000));

  // Step 3: W2 submits work
  console.log("\n--- Step 3: W2 submits work ---");
  const resultHash = Buffer.from("completed_work_hash_12345");

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
  } catch (e) {
    console.log("[ERROR] submitWork:", e.message);
    if (e.simulationResponse) e.simulationResponse.logs.forEach(l => console.log(" ", l));
    return;
  }

  await new Promise(r => setTimeout(r, 1000));

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
  } catch (e) {
    console.log("[ERROR] confirmJob:", e.message);
    if (e.simulationResponse) e.simulationResponse.logs.forEach(l => console.log(" ", l));
    return;
  }

  await new Promise(r => setTimeout(r, 1000));

  // Get balances after
  const w1BalAfter = Number((await getAccount(conn, w1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;
  const w2BalAfter = Number((await getAccount(conn, w2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;

  console.log("\n--- Balances AFTER ---");
  console.log("W1 (Hirer):", w1BalAfter, "ECASH (change:", w1BalAfter - w1BalBefore, ")");
  console.log("W2 (Worker):", w2BalAfter, "ECASH (change:", w2BalAfter - w2BalBefore, ")");

  // Verify
  const w2Received = w2BalAfter - w2BalBefore;
  const w1Paid = w1BalBefore - w1BalAfter;
  const burned = w1Paid - w2Received;

  console.log("\n--- Verification ---");
  console.log("W1 paid:", w1Paid, "ECASH");
  console.log("W2 received:", w2Received, "ECASH (expected: 98)");
  console.log("Burned:", burned, "ECASH (expected: 2)");

  const passReceived = Math.abs(w2Received - 98) < 0.01;
  const passBurned = Math.abs(burned - 2) < 0.01;

  console.log("\n[" + (passReceived ? "PASS" : "FAIL") + "] W2 received 98 ECASH (98% of 100)");
  console.log("[" + (passBurned ? "PASS" : "FAIL") + "] 2 ECASH burned (2%)");

  // Check W2 profile for jobs_completed_as_worker
  console.log("\n--- Checking W2 Profile ---");
  try {
    const profileInfo = await conn.getAccountInfo(w2ProfilePda);
    // AgentProfile layout after discriminator (8):
    // owner (32), name (4 + string), description (4 + string), ...
    // This is complex to parse raw, let's just note it exists
    console.log("W2 profile exists, size:", profileInfo.data.length, "bytes");
    console.log("[INFO] jobs_completed_as_worker should have incremented (verify in final state)");
  } catch (e) {
    console.log("[WARN] Could not read profile:", e.message);
  }

  console.log("\n============================================================");
  console.log("  TEST 3 COMPLETE");
  console.log("============================================================");
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
