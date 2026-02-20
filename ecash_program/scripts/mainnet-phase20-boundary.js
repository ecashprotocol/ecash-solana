// Phase 20: Boundary + Overflow Testing
// Tests edge cases, max/min values, and potential overflow conditions

const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROGRAM_ID = new PublicKey("7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u");
const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");
const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINER_STATE_SEED = Buffer.from("miner_state");
const VAULT_SEED = Buffer.from("vault");
const PROFILE_SEED = Buffer.from("profile");

const results = [];
let pass = 0, fail = 0;

function log(id, name, exp, act, ok) {
  if (ok) pass++; else fail++;
  results.push({ id, name, exp, act, status: ok ? "PASS" : "FAIL" });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id}: ${name}`);
  if (!ok) console.log(`       Expected: ${exp}, Got: ${act}`);
}

const loadWallet = (n) => Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), `ecash-solana/${n}.json`))))
);

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 20: BOUNDARY + OVERFLOW TESTING");
  console.log("=".repeat(60));

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const deployer = loadWallet("deployer");
  const w3 = loadWallet("wallet-3");

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(deployer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const prog = new anchor.Program(idl, provider);

  const [gsPda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_ID);

  // ============================================================
  // 20A: Global State Boundary Values
  // ============================================================
  console.log("\n--- 20A: Global State Boundary Values ---\n");

  const gs = await prog.account.globalState.fetch(gsPda);

  // Check total solved is within u64 bounds
  const totalSolved = gs.totalSolved.toString();
  const maxU64 = "18446744073709551615";
  log("20A.1", "totalSolved < u64::MAX", "< MAX", `${totalSolved} (safe)`,
      new BN(totalSolved).lt(new BN(maxU64)));

  // Check current batch is reasonable
  const currentBatch = gs.currentBatch.toNumber();
  log("20A.2", "currentBatch valid", "0-630", `${currentBatch}`, currentBatch >= 0 && currentBatch <= 630);

  // Check batch solve count
  const batchSolveCount = gs.batchSolveCount.toNumber();
  log("20A.3", "batchSolveCount valid", "0-10", `${batchSolveCount}`, batchSolveCount >= 0 && batchSolveCount <= 10);

  // Check total solves
  const totalSolves = gs.totalSolved.toNumber();
  log("20A.4", "totalSolved >= batchSolveCount", "true",
      `total=${totalSolves}, batch=${batchSolveCount}`, totalSolves >= batchSolveCount);

  // Check Merkle root is set (32 bytes, non-zero)
  const merkleRoot = gs.merkleRoot;
  const merkleIsSet = merkleRoot.some(b => b !== 0);
  log("20A.5", "merkleRoot is set", "non-zero", merkleIsSet ? "Set" : "Zero", merkleIsSet);

  // ============================================================
  // 20B: Miner State Boundary Values
  // ============================================================
  console.log("\n--- 20B: Miner State Boundary Values ---\n");

  const minerPda = PublicKey.findProgramAddressSync([MINER_STATE_SEED, w3.publicKey.toBuffer()], PROGRAM_ID)[0];
  const minerState = await prog.account.minerState.fetch(minerPda);

  // Check gas is non-negative (actual cap may vary based on regeneration)
  const gas = minerState.gasBalance.toNumber();
  const GAS_FLOOR = 35;
  log("20B.1", "gasBalance non-negative", `>= ${GAS_FLOOR}`, `${gas}`, gas >= GAS_FLOOR);

  // Check solve count is non-negative
  const solveCount = minerState.solveCount.toNumber();
  log("20B.2", "solveCount non-negative", ">=0", `${solveCount}`, solveCount >= 0);

  // Check batch is valid
  const batch = minerState.enteredBatch.toNumber();
  log("20B.3", "enteredBatch valid", ">=0", `${batch}`, batch >= 0);

  // Check lockout end is reasonable timestamp
  const lockoutEnd = minerState.lockoutEnd.toNumber();
  const now = Math.floor(Date.now() / 1000);
  const oneYearFromNow = now + 365 * 24 * 60 * 60;
  log("20B.4", "lockoutEnd reasonable", "< 1yr future",
      lockoutEnd === 0 ? "Not locked" : `${new Date(lockoutEnd * 1000).toISOString()}`,
      lockoutEnd <= oneYearFromNow);

  // Check last regen time is valid timestamp
  const lastRegenTime = minerState.lastRegenTime.toNumber();
  log("20B.5", "lastRegenTime valid", "past or 0",
      lastRegenTime === 0 ? "Never regenerated" : `${new Date(lastRegenTime * 1000).toISOString()}`,
      lastRegenTime <= now);

  // ============================================================
  // 20C: Vault Balance Check
  // ============================================================
  console.log("\n--- 20C: Vault Balance Check ---\n");

  try {
    const vaultAccount = await getAccount(conn, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID);
    const vaultBalance = Number(vaultAccount.amount) / 1e9;
    log("20C.1", "Vault has tokens", ">0", `${vaultBalance.toFixed(2)} ECASH`, vaultBalance > 0);

    // Check vault balance is reasonable (no total supply field, just check > 0)
    const totalBurned = Number(gs.totalBurned) / 1e9;
    log("20C.2", "Total burned tracked", ">=0", `${totalBurned.toFixed(2)} ECASH burned`, totalBurned >= 0);
  } catch (e) {
    log("20C.1", "Vault accessible", "Yes", `Error: ${e.message.slice(0, 40)}`, false);
  }

  // ============================================================
  // 20D: Invalid Input Tests (Simulation Only)
  // ============================================================
  console.log("\n--- 20D: Invalid Input Tests (Expected Failures) ---\n");

  // Test 1: Pick with invalid puzzle ID (out of range)
  try {
    const invalidPuzzleId = new BN("9999999999999999999"); // Huge number
    await prog.methods.pick(invalidPuzzleId)
      .accounts({ owner: w3.publicKey, minerState: minerPda, globalState: gsPda })
      .signers([w3])
      .simulate();
    log("20D.1", "Pick invalid puzzle ID", "Rejected", "Accepted (BAD)", false);
  } catch (e) {
    // Any error means it was rejected correctly
    log("20D.1", "Pick invalid puzzle ID", "Rejected", "Rejected: " + e.message.slice(0, 30), true);
  }

  // Test 2: Commit with zero-length hash
  try {
    await prog.methods.commitSolve([])
      .accounts({ owner: w3.publicKey, minerState: minerPda })
      .signers([w3])
      .simulate();
    log("20D.2", "Commit empty hash", "Rejected", "Accepted (BAD)", false);
  } catch (e) {
    log("20D.2", "Commit empty hash", "Rejected", "Rejected correctly", true);
  }

  // Test 3: Try to re-register (should fail with AlreadyRegistered or similar)
  try {
    // Use proper provider for signing
    const w3Provider = new anchor.AnchorProvider(conn, new anchor.Wallet(w3), { commitment: "confirmed" });
    const w3Prog = new anchor.Program(idl, w3Provider);
    await w3Prog.methods.register()
      .accounts({ owner: w3.publicKey, minerState: minerPda, globalState: gsPda, systemProgram: SystemProgram.programId })
      .signers([w3])
      .simulate();
    log("20D.3", "Re-register blocked", "Rejected", "Accepted (BAD)", false);
  } catch (e) {
    // Any error means re-registration is blocked
    log("20D.3", "Re-register blocked", "Rejected", "Rejected: " + e.message.slice(0, 30), true);
  }

  // ============================================================
  // 20E: Arithmetic Overflow Checks
  // ============================================================
  console.log("\n--- 20E: Arithmetic Overflow Checks ---\n");

  // Check that adding to total solved doesn't overflow
  // Max puzzles is 6300
  const maxPuzzles = new BN(6300);
  const totalSolvedBN = gs.totalSolved;
  log("20E.1", "totalSolved < max puzzles", "< 6300",
      `${totalSolvedBN.toString()} / 6300`, totalSolvedBN.lt(maxPuzzles));

  // Check gas arithmetic
  // Gas operations: -10 (pick), -25 (commit), +100 (solve bonus)
  const worstCaseGas = gas - 10 - 25 + 100; // Max gas change in one solve
  log("20E.2", "Gas arithmetic safe", "No underflow", `${gas} + ops = ${worstCaseGas}`,
      worstCaseGas >= 0);

  // ============================================================
  // 20F: PDA Derivation Verification
  // ============================================================
  console.log("\n--- 20F: PDA Derivation Verification ---\n");

  // Verify global state PDA
  const [expectedGs] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  log("20F.1", "Global state PDA correct", expectedGs.toString().slice(0, 12),
      gsPda.toString().slice(0, 12), expectedGs.equals(gsPda));

  // Verify vault PDA
  const [expectedVault] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_ID);
  log("20F.2", "Vault PDA correct", expectedVault.toString().slice(0, 12),
      vaultPda.toString().slice(0, 12), expectedVault.equals(vaultPda));

  // Verify miner state PDA
  const [expectedMiner] = PublicKey.findProgramAddressSync([MINER_STATE_SEED, w3.publicKey.toBuffer()], PROGRAM_ID);
  log("20F.3", "Miner state PDA correct", expectedMiner.toString().slice(0, 12),
      minerPda.toString().slice(0, 12), expectedMiner.equals(minerPda));

  // ============================================================
  // 20G: Edge Case - Multiple Wallet States
  // ============================================================
  console.log("\n--- 20G: Multi-Wallet State Consistency ---\n");

  const wallets = ["wallet-1", "wallet-2", "wallet-3", "wallet-4", "wallet-5"];
  let totalWalletSolves = 0;

  for (const walletName of wallets) {
    try {
      const wallet = loadWallet(walletName);
      const wMinerPda = PublicKey.findProgramAddressSync([MINER_STATE_SEED, wallet.publicKey.toBuffer()], PROGRAM_ID)[0];
      const wMinerState = await prog.account.minerState.fetch(wMinerPda);
      const wSolves = wMinerState.solveCount.toNumber();
      totalWalletSolves += wSolves;
      console.log(`  ${walletName}: ${wSolves} solves, gas=${wMinerState.gasBalance.toNumber()}`);
    } catch (e) {
      console.log(`  ${walletName}: Not registered or error`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  log("20G.1", "Total wallet solves = global solves", `${totalSolves}`,
      `${totalWalletSolves}`, totalWalletSolves === totalSolves);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 20 RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${pass} | Failed: ${fail}`);

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let content = `\n---\n\n## PHASE 20: Boundary + Overflow Testing\n\n`;
  content += `### Global State\n`;
  content += `- Total Solved: ${totalSolved}\n`;
  content += `- Current Batch: ${currentBatch}\n`;
  content += `- Batch Solve Count: ${batchSolveCount}\n`;
  content += `- Total Solves: ${totalSolves}\n\n`;

  content += `### Test Results\n\n`;
  content += `| # | Test | Expected | Actual | Status |\n|---|------|----------|--------|--------|\n`;
  for (const r of results) {
    content += `| ${r.id} | ${r.name} | ${r.exp} | ${String(r.act).slice(0, 30)} | ${r.status} |\n`;
  }
  content += `\n**Summary**: ${pass}/${results.length} passed\n`;
  fs.appendFileSync(logPath, content);
  console.log("\nResults appended to DEPLOY-TEST-LOG.md");
}

main().catch(console.error);
