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
} = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROGRAM_ID = new PublicKey("7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u");
const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINER_STATE_SEED = Buffer.from("miner_state");
const AGENT_PROFILE_SEED = Buffer.from("agent_profile");
const ARBITRATOR_STATS_SEED = Buffer.from("arbitrator_stats");
const DISPUTE_SEED = Buffer.from("dispute");
const JOB_SEED = Buffer.from("job");
const JOB_ESCROW_SEED = Buffer.from("job_escrow");

async function loadWallet(name) {
  const walletPath = path.join(os.homedir(), `ecash-solana/${name}.json`);
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
}

async function main() {
  console.log("=".repeat(60));
  console.log("  FIX: REGISTER W3 PROFILE + ENROLL AS ARBITRATOR");
  console.log("=".repeat(60));

  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const deployer = await loadWallet("deployer");
  const wallet3 = await loadWallet("wallet-3");

  const idlPath = path.join(__dirname, "../target/idl/ecash_program.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  const provider = new AnchorProvider(connection, new anchor.Wallet(deployer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl, provider);

  const [globalStatePda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  const getMinerPda = (owner) => PublicKey.findProgramAddressSync([MINER_STATE_SEED, owner.toBuffer()], PROGRAM_ID)[0];
  const getAgentProfilePda = (owner) => PublicKey.findProgramAddressSync([AGENT_PROFILE_SEED, owner.toBuffer()], PROGRAM_ID)[0];
  const getArbitratorStatsPda = (owner) => PublicKey.findProgramAddressSync([ARBITRATOR_STATS_SEED, owner.toBuffer()], PROGRAM_ID)[0];
  const getDisputePda = (jobId) => PublicKey.findProgramAddressSync([DISPUTE_SEED, new BN(jobId).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];
  const getJobPda = (jobId) => PublicKey.findProgramAddressSync([JOB_SEED, new BN(jobId).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];
  const getJobEscrowPda = (jobId) => PublicKey.findProgramAddressSync([JOB_ESCROW_SEED, new BN(jobId).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];

  // Step 1: Register W3 profile
  console.log("\n--- Step 1: Register W3 Profile ---\n");
  try {
    const agentProfilePda = getAgentProfilePda(wallet3.publicKey);
    const minerStatePda = getMinerPda(wallet3.publicKey);

    const tx = await program.methods
      .registerProfile("Carol", "Experienced arbitrator")
      .accounts({
        owner: wallet3.publicKey,
        globalState: globalStatePda,
        minerState: minerStatePda,
        agentProfile: agentProfilePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet3])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    console.log(`[PASS] W3 profile registered: ${tx}`);
  } catch (e) {
    if (e.message.includes("already in use")) {
      console.log("[INFO] W3 profile already exists");
    } else {
      console.log(`[FAIL] Error: ${e.message}`);
    }
  }
  await new Promise(r => setTimeout(r, 3000));

  // Step 2: Enroll W3 as arbitrator
  console.log("\n--- Step 2: Enroll W3 as Arbitrator ---\n");
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
    console.log(`[PASS] W3 enrolled as arbitrator: ${tx}`);
    console.log(`       isActive: ${stats.isActive}`);
  } catch (e) {
    if (e.message.includes("already in use")) {
      console.log("[INFO] W3 already enrolled as arbitrator");
    } else {
      console.log(`[FAIL] Error: ${e.message}`);
      if (e.logs) console.log("Logs:", e.logs.slice(-5));
    }
  }
  await new Promise(r => setTimeout(r, 3000));

  // Step 3: Assign W3 to dispute (Job 6)
  console.log("\n--- Step 3: Assign W3 to Dispute ---\n");
  const disputeJobId = 6;
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
    console.log(`[PASS] W3 assigned to dispute: ${tx}`);
    console.log(`       Arbitrator 1: ${dispute.arbitrator1.toString()}`);
    console.log(`       Arbitrator 2: ${dispute.arbitrator2.toString()}`);
    console.log(`       Arbitrator 3: ${dispute.arbitrator3.toString()}`);
  } catch (e) {
    console.log(`[FAIL] Error: ${e.message}`);
    if (e.logs) console.log("Logs:", e.logs.slice(-5));
  }
  await new Promise(r => setTimeout(r, 3000));

  // Step 4: W3 votes on dispute
  console.log("\n--- Step 4: W3 Votes on Dispute ---\n");
  try {
    const disputePda = getDisputePda(disputeJobId);

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
    console.log(`[PASS] W3 voted: ${tx}`);
    console.log(`       Votes received: ${dispute.votesReceived}`);
    console.log(`       Hirer votes: ${dispute.hirerVotes}`);
    console.log(`       Worker votes: ${dispute.workerVotes}`);
  } catch (e) {
    console.log(`[FAIL] Error: ${e.message}`);
    if (e.logs) console.log("Logs:", e.logs.slice(-5));
  }

  console.log("\n=== DONE ===");
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
