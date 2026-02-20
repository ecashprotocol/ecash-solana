// Phase 17: Solve 10 puzzles with W1 to reach Silver tier
// Required for arbitration enrollment in Phase 18

const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { keccak_256 } = require("js-sha3");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROGRAM_ID = new PublicKey("7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u");
const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");
const GLOBAL_STATE_SEED = Buffer.from("global_state");
const VAULT_SEED = Buffer.from("vault");
const MINER_STATE_SEED = Buffer.from("miner_state");
const PUZZLE_SOLVED_SEED = Buffer.from("puzzle_solved");

const results = [];
let pass = 0, fail = 0;

function log(id, name, exp, act, tx, ok) {
  if (ok) pass++; else fail++;
  results.push({ id, name, exp, act, tx, status: ok ? "PASS" : "FAIL" });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id}: ${name}`);
  if (tx) console.log(`       TX: ${tx}`);
  if (!ok) console.log(`       Expected: ${exp}, Got: ${act}`);
}

const loadWallet = (n) => Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), `ecash-solana/${n}.json`))))
);

function keccak(data) {
  return Buffer.from(keccak_256.arrayBuffer(data));
}

// Puzzle answers for batch 0 and batch 1
const puzzleAnswers = {
  // Batch 0 (puzzles 0-9)
  0: "the rosetta stone",
  1: "fibonacci sequence",
  2: "golden ratio",
  3: "prime number",
  4: "euler identity",
  5: "pythagorean theorem",
  6: "archimedes principle",
  7: "newtons laws",
  8: "theory of relativity",
  9: "quantum mechanics",
  // Batch 1 (puzzles 10-19) - need to discover or use test answers
  10: "higgs boson",
  11: "dark matter",
  12: "black hole",
  13: "string theory",
  14: "wave function",
  15: "uncertainty principle",
  16: "schrodinger cat",
  17: "quantum entanglement",
  18: "maxwell equations",
  19: "thermodynamics",
};

async function solvePuzzle(conn, prog, wallet, puzzleId, gsPda, vaultPda, minerPda, skipPick = false) {
  const answer = puzzleAnswers[puzzleId];
  if (!answer) {
    return { success: false, error: `No answer for puzzle ${puzzleId}` };
  }

  const ata = getAssociatedTokenAddressSync(MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const puzzleSolvedPda = PublicKey.findProgramAddressSync(
    [PUZZLE_SOLVED_SEED, new BN(puzzleId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];

  // Check if already solved
  try {
    await prog.account.puzzleSolved.fetch(puzzleSolvedPda);
    return { success: false, error: `Puzzle ${puzzleId} already solved` };
  } catch {}

  const txHashes = [];

  try {
    // Step 1: Pick the puzzle (skip if already picked)
    if (!skipPick) {
      console.log(`  [${puzzleId}] Picking puzzle...`);
      const pickTx = await prog.methods.pick(new BN(puzzleId))
        .accounts({
          owner: wallet.publicKey,
          minerState: minerPda,
          globalState: gsPda,
        })
        .signers([wallet])
        .rpc();
      await conn.confirmTransaction(pickTx, "confirmed");
      txHashes.push({ step: "pick", tx: pickTx });
      console.log(`  [${puzzleId}] Picked: ${pickTx.slice(0, 16)}...`);
    } else {
      console.log(`  [${puzzleId}] Using existing pick...`);
    }

    // Step 2: Commit
    const salt = Buffer.alloc(32);
    salt.writeUInt32LE(puzzleId + 100, 0); // Deterministic salt
    const answerBuf = Buffer.from(answer.toLowerCase());
    const commitHash = keccak(Buffer.concat([answerBuf, salt]));

    console.log(`  [${puzzleId}] Committing...`);
    const commitTx = await prog.methods.commitSolve([...commitHash])
      .accounts({
        owner: wallet.publicKey,
        minerState: minerPda,
      })
      .signers([wallet])
      .rpc();
    await conn.confirmTransaction(commitTx, "confirmed");
    txHashes.push({ step: "commit", tx: commitTx });
    console.log(`  [${puzzleId}] Committed: ${commitTx.slice(0, 16)}...`);

    // Wait for next slot
    await new Promise(r => setTimeout(r, 500));

    // Step 3: Reveal
    console.log(`  [${puzzleId}] Revealing...`);
    const revealTx = await prog.methods.revealSolve(answer.toLowerCase(), [...salt])
      .accounts({
        owner: wallet.publicKey,
        minerState: minerPda,
        globalState: gsPda,
        puzzleSolved: puzzleSolvedPda,
        mint: MINT,
        vault: vaultPda,
        minerTokenAccount: ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet])
      .rpc();
    await conn.confirmTransaction(revealTx, "confirmed");
    txHashes.push({ step: "reveal", tx: revealTx });
    console.log(`  [${puzzleId}] Revealed: ${revealTx.slice(0, 16)}...`);

    return { success: true, txHashes };
  } catch (e) {
    return { success: false, error: e.message.slice(0, 100), txHashes };
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 17: SILVER TIER ACHIEVEMENT");
  console.log("=".repeat(60));

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const deployer = loadWallet("deployer");
  const w1 = loadWallet("wallet-1");

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  // Use w1 as the provider wallet since we're signing with w1
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(w1), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const prog = new anchor.Program(idl, provider);

  const [gsPda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_ID);
  const minerPda = PublicKey.findProgramAddressSync([MINER_STATE_SEED, w1.publicKey.toBuffer()], PROGRAM_ID)[0];

  // ============================================================
  // 17A: Current State Check
  // ============================================================
  console.log("\n--- 17A: Current State ---\n");

  let gs = await prog.account.globalState.fetch(gsPda);
  let minerState = await prog.account.minerState.fetch(minerPda);

  const initialSolves = minerState.solveCount.toNumber();
  const currentBatch = gs.currentBatch.toNumber();
  const batchSolveCount = gs.batchSolveCount.toNumber();

  console.log(`W1 address: ${w1.publicKey.toString()}`);
  console.log(`W1 current solves: ${initialSolves}`);
  console.log(`Current batch: ${currentBatch}`);
  console.log(`Batch solved count: ${batchSolveCount}`);
  console.log(`Target: 10 solves (Silver tier)`);
  console.log(`Need: ${10 - initialSolves} more solves`);

  log("17A.1", "Initial solve count", "Known", String(initialSolves), null, true);

  // ============================================================
  // 17B: Solve Puzzles
  // ============================================================
  console.log("\n--- 17B: Solving Puzzles ---\n");

  const allTxHashes = [];
  let puzzlesToSolve = [];

  // Determine which puzzles to solve
  // Start with unsolved puzzles in current batch
  const batchStart = currentBatch * 10;
  for (let i = batchStart; i < batchStart + 10; i++) {
    const puzzleSolvedPda = PublicKey.findProgramAddressSync(
      [PUZZLE_SOLVED_SEED, new BN(i).toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID
    )[0];
    try {
      await prog.account.puzzleSolved.fetch(puzzleSolvedPda);
      // Already solved
    } catch {
      // Not solved, add to list
      if (puzzleAnswers[i]) {
        puzzlesToSolve.push(i);
      }
    }
    await new Promise(r => setTimeout(r, 200)); // Rate limit
  }

  console.log(`Available unsolved puzzles in batch ${currentBatch}: ${puzzlesToSolve.join(", ")}`);

  let solveCount = initialSolves;
  let solvedThisRun = 0;

  while (solveCount < 10 && puzzlesToSolve.length > 0) {
    const puzzleId = puzzlesToSolve.shift();
    console.log(`\n--- Solving puzzle ${puzzleId} (${solveCount + 1}/10 target) ---`);

    // Check if miner has active pick/commit that needs clearing
    minerState = await prog.account.minerState.fetch(minerPda);

    let skipPick = false;

    if (minerState.hasPick && minerState.activePick.toNumber() !== puzzleId) {
      // Has pick for different puzzle - need to wait for it to expire or solve that one first
      console.log(`  Has pick for puzzle ${minerState.activePick.toNumber()}, switching to that puzzle`);
      // Put current puzzle back and prioritize the picked one
      puzzlesToSolve.unshift(puzzleId);
      puzzlesToSolve.unshift(minerState.activePick.toNumber());
      // Remove duplicates
      puzzlesToSolve = [...new Set(puzzlesToSolve)];
      continue;
    }

    if (minerState.hasPick && minerState.activePick.toNumber() === puzzleId) {
      // Already have pick for this puzzle
      skipPick = true;
    }

    if (minerState.hasCommit) {
      // Has a commit, need to reveal or cancel
      console.log(`  Has active commit, attempting to cancel if expired...`);
      // Try to cancel if expired
      try {
        const cancelTx = await prog.methods.cancelExpiredCommit()
          .accounts({
            owner: w1.publicKey,
            minerState: minerPda,
          })
          .signers([w1])
          .rpc();
        await conn.confirmTransaction(cancelTx, "confirmed");
        console.log(`  Cancelled expired commit: ${cancelTx.slice(0, 16)}...`);
      } catch (e) {
        console.log(`  Cannot cancel commit (may need to reveal): ${e.message.slice(0, 50)}`);
        continue;
      }
    }

    const result = await solvePuzzle(conn, prog, w1, puzzleId, gsPda, vaultPda, minerPda, skipPick);

    if (result.success) {
      solveCount++;
      solvedThisRun++;
      for (const txInfo of result.txHashes) {
        allTxHashes.push({ puzzle: puzzleId, ...txInfo });
      }
      log(`17B.${solvedThisRun}`, `Solve puzzle ${puzzleId}`, "Success", "Solved",
          result.txHashes.find(t => t.step === "reveal")?.tx, true);

      // Rate limit - longer wait to avoid 429
      await new Promise(r => setTimeout(r, 3000));

      // Check if batch advanced
      gs = await prog.account.globalState.fetch(gsPda);
      const newBatch = gs.currentBatch.toNumber();
      if (newBatch > currentBatch) {
        console.log(`\n*** Batch advanced to ${newBatch}! Loading new puzzles... ***\n`);
        // Load puzzles from new batch
        const newBatchStart = newBatch * 10;
        puzzlesToSolve = [];
        for (let i = newBatchStart; i < newBatchStart + 10; i++) {
          const puzzleSolvedPda = PublicKey.findProgramAddressSync(
            [PUZZLE_SOLVED_SEED, new BN(i).toArrayLike(Buffer, "le", 8)],
            PROGRAM_ID
          )[0];
          try {
            await prog.account.puzzleSolved.fetch(puzzleSolvedPda);
          } catch {
            if (puzzleAnswers[i]) {
              puzzlesToSolve.push(i);
            }
          }
        }
        console.log(`New puzzles available: ${puzzlesToSolve.join(", ")}`);
      }
    } else {
      console.log(`  Failed: ${result.error}`);
      log(`17B.${solvedThisRun + 1}`, `Solve puzzle ${puzzleId}`, "Success", result.error, null, false);
    }
  }

  // ============================================================
  // 17C: Final State Verification
  // ============================================================
  console.log("\n--- 17C: Final State ---\n");

  minerState = await prog.account.minerState.fetch(minerPda);
  const finalSolves = minerState.solveCount.toNumber();
  const tier = finalSolves >= 50 ? "Diamond" : finalSolves >= 25 ? "Gold" : finalSolves >= 10 ? "Silver" : finalSolves >= 1 ? "Bronze" : "None";

  console.log(`W1 final solve count: ${finalSolves}`);
  console.log(`W1 tier: ${tier}`);
  console.log(`Solved this run: ${solvedThisRun}`);

  const reachedSilver = finalSolves >= 10;
  log("17C.1", "Silver tier achieved", "10+ solves", `${finalSolves} solves (${tier})`, null, reachedSilver);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 17 RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${pass} | Failed: ${fail}`);
  console.log(`Puzzles solved this run: ${solvedThisRun}`);
  console.log(`W1 total solves: ${finalSolves}`);
  console.log(`Tier: ${tier}`);

  // Transaction log
  console.log("\n--- Transaction Log ---");
  for (const tx of allTxHashes) {
    console.log(`  Puzzle ${tx.puzzle} ${tx.step}: ${tx.tx}`);
  }

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let content = `\n---\n\n## PHASE 17: Silver Tier Achievement\n\n`;
  content += `**Wallet**: W1 (${w1.publicKey.toString().slice(0, 12)}...)\n`;
  content += `**Initial Solves**: ${initialSolves}\n`;
  content += `**Final Solves**: ${finalSolves}\n`;
  content += `**Tier Achieved**: ${tier}\n\n`;

  content += `### Puzzle Solves\n\n`;
  content += `| Puzzle | Step | TX Hash |\n|--------|------|---------||\n`;
  for (const tx of allTxHashes) {
    content += `| ${tx.puzzle} | ${tx.step} | [${tx.tx.slice(0, 8)}...](https://solscan.io/tx/${tx.tx}) |\n`;
  }

  content += `\n### Test Results\n\n`;
  content += `| # | Test | Expected | Actual | TX | Status |\n|---|------|----------|--------|-----|--------|\n`;
  for (const r of results) {
    const txL = r.tx ? `[${r.tx.slice(0, 8)}...](https://solscan.io/tx/${r.tx})` : "N/A";
    content += `| ${r.id} | ${r.name} | ${r.exp} | ${String(r.act).slice(0, 40)} | ${txL} | ${r.status} |\n`;
  }
  content += `\n**Summary**: ${pass}/${results.length} passed\n`;

  fs.appendFileSync(logPath, content);
  console.log("\nResults appended to DEPLOY-TEST-LOG.md");

  if (!reachedSilver) {
    console.log("\n*** WARNING: Did not reach Silver tier! ***");
    console.log("Arbitration tests in Phase 18 will be blocked.");
    console.log("May need more puzzle answers or batch to advance.");
  }
}

main().catch(console.error);
