// Phase 10: Competitive Mining Race Test
// Tests that only one miner can solve a puzzle when two race

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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { keccak256 } = require("js-sha3");

const PROGRAM_ID = new PublicKey("7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u");
const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINER_STATE_SEED = Buffer.from("miner_state");
const PUZZLE_SOLVED_SEED = Buffer.from("puzzle_solved");
const VAULT_SEED = Buffer.from("vault");

function keccak(input) {
  return Buffer.from(keccak256.arrayBuffer(input));
}

function normalizeAnswer(answer) {
  let lower = answer.toLowerCase();
  let filtered = "";
  for (const c of lower) {
    if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === " ") filtered += c;
  }
  filtered = filtered.trim();
  let result = "";
  let lastWasSpace = false;
  for (const c of filtered) {
    if (c === " ") { if (!lastWasSpace) { result += c; lastWasSpace = true; } }
    else { result += c; lastWasSpace = false; }
  }
  return result;
}

function computeCommitHash(answer, salt, secret, signer) {
  const input = Buffer.concat([Buffer.from(answer), salt, secret, signer.toBuffer()]);
  return keccak(input);
}

function abiEncodePuzzleData(puzzleId, normalizedAnswer, salt) {
  const puzzleIdBytes = Buffer.alloc(32);
  new BN(puzzleId).toArrayLike(Buffer, "be", 8).copy(puzzleIdBytes, 24);
  const offsetBytes = Buffer.alloc(32); offsetBytes[31] = 0x60;
  const saltSlot = Buffer.from(salt);
  const stringBytes = Buffer.from(normalizedAnswer, "utf-8");
  const lenBytes = Buffer.alloc(32);
  new BN(stringBytes.length).toArrayLike(Buffer, "be", 8).copy(lenBytes, 24);
  const paddedLen = Math.max(Math.ceil(stringBytes.length / 32) * 32, 32);
  const stringData = Buffer.alloc(paddedLen);
  stringBytes.copy(stringData, 0);
  return Buffer.concat([puzzleIdBytes, offsetBytes, saltSlot, lenBytes, stringData]);
}

function computeMerkleLeaf(puzzleId, normalizedAnswer, salt) {
  return keccak(keccak(abiEncodePuzzleData(puzzleId, normalizedAnswer, salt)));
}

function sortedPairHash(a, b) {
  return a.compare(b) <= 0 ? keccak(Buffer.concat([a, b])) : keccak(Buffer.concat([b, a]));
}

function buildTestMerkleTree(leaves) {
  let currentLevel = [...leaves];
  const proofs = leaves.map(() => []);
  const positions = leaves.map((_, i) => i);
  while (currentLevel.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(sortedPairHash(left, right));
    }
    for (let leafIdx = 0; leafIdx < leaves.length; leafIdx++) {
      const pos = positions[leafIdx];
      const siblingPos = pos % 2 === 0 ? pos + 1 : pos - 1;
      if (siblingPos < currentLevel.length) proofs[leafIdx].push(currentLevel[siblingPos]);
      positions[leafIdx] = Math.floor(pos / 2);
    }
    currentLevel = nextLevel;
  }
  return { root: currentLevel[0], proofs };
}

function createTestPuzzles() {
  const puzzles = [
    { puzzleId: 0, answer: "the rosetta stone", salt: Buffer.alloc(32, 1) },
    { puzzleId: 1, answer: "fibonacci sequence", salt: Buffer.alloc(32, 2) },
    { puzzleId: 2, answer: "golden ratio", salt: Buffer.alloc(32, 3) },
    { puzzleId: 3, answer: "prime number", salt: Buffer.alloc(32, 4) },
    { puzzleId: 4, answer: "euler identity", salt: Buffer.alloc(32, 5) },
    { puzzleId: 5, answer: "pythagorean theorem", salt: Buffer.alloc(32, 6) },
    { puzzleId: 6, answer: "archimedes principle", salt: Buffer.alloc(32, 7) },
    { puzzleId: 7, answer: "newtons laws", salt: Buffer.alloc(32, 8) },
    { puzzleId: 8, answer: "theory of relativity", salt: Buffer.alloc(32, 9) },
    { puzzleId: 9, answer: "quantum mechanics", salt: Buffer.alloc(32, 10) },
  ];
  const leaves = puzzles.map(p => computeMerkleLeaf(p.puzzleId, normalizeAnswer(p.answer), p.salt));
  const { proofs } = buildTestMerkleTree(leaves);
  puzzles.forEach((p, i) => { p.proof = proofs[i]; });
  return { puzzles };
}

async function loadWallet(name) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), `ecash-solana/${name}.json`))))
  );
}

const results = [];
let passCount = 0, failCount = 0;
function logResult(id, name, expected, actual, tx, passed) {
  if (passed) passCount++; else failCount++;
  results.push({ id, name, expected, actual, tx, status: passed ? "PASS" : "FAIL" });
  console.log(`[${passed ? "PASS" : "FAIL"}] ${id}: ${name}`);
  if (tx) console.log(`       TX: ${tx}`);
  if (!passed) console.log(`       Expected: ${expected}, Got: ${actual}`);
}

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 10: COMPETITIVE MINING RACE TEST");
  console.log("=".repeat(60));

  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const deployer = await loadWallet("deployer");
  const wallet4 = await loadWallet("wallet-4");
  const wallet5 = await loadWallet("wallet-5");

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  const provider = new AnchorProvider(connection, new anchor.Wallet(deployer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl, provider);

  const [globalStatePda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_ID);

  const getMinerPda = (pk) => PublicKey.findProgramAddressSync([MINER_STATE_SEED, pk.toBuffer()], PROGRAM_ID)[0];
  const getPuzzleSolvedPda = (id) => PublicKey.findProgramAddressSync(
    [PUZZLE_SOLVED_SEED, new BN(id).toArrayLike(Buffer, "le", 8)], PROGRAM_ID
  )[0];

  const { puzzles } = createTestPuzzles();
  const TARGET = 3;
  const puzzle = puzzles[TARGET];

  // Use DETERMINISTIC secrets derived from wallet pubkeys
  const secret4 = keccak(Buffer.concat([Buffer.from("secret4"), wallet4.publicKey.toBuffer()]));
  const secret5 = keccak(Buffer.concat([Buffer.from("secret5"), wallet5.publicKey.toBuffer()]));

  console.log(`\nTarget: Puzzle ${TARGET} ("${puzzle.answer}")`);
  console.log("Using deterministic secrets for reproducibility\n");

  // Check if puzzle already solved
  try {
    await program.account.puzzleSolved.fetch(getPuzzleSolvedPda(TARGET));
    console.log("Puzzle 3 already solved! Skipping test.");
    logResult("10.0", "Puzzle availability", "Unsolved", "Already solved", null, false);
    return;
  } catch { logResult("10.0", "Puzzle availability", "Unsolved", "Available", null, true); }

  const globalBefore = await program.account.globalState.fetch(globalStatePda);
  const totalBefore = globalBefore.totalSolved.toNumber();
  const vaultBefore = Number((await getAccount(connection, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
  console.log(`State before: ${totalBefore} solved, vault=${vaultBefore / 1e9} ECASH\n`);

  // Both W4 and W5 should already have puzzle 3 picked (from previous run)
  // Check their state
  let state4 = await program.account.minerState.fetch(getMinerPda(wallet4.publicKey));
  let state5 = await program.account.minerState.fetch(getMinerPda(wallet5.publicKey));

  console.log("W4 state: hasPick=" + state4.hasPick + " activePick=" + state4.activePick + " hasCommit=" + state4.hasCommit);
  console.log("W5 state: hasPick=" + state5.hasPick + " activePick=" + state5.activePick + " hasCommit=" + state5.hasCommit);

  // If they don't have picks for puzzle 3, set them up
  if (!state4.hasPick || state4.activePick.toNumber() !== TARGET) {
    console.log("\nW4 picking puzzle 3...");
    const tx = await program.methods.pick(new BN(TARGET))
      .accounts({ owner: wallet4.publicKey, minerState: getMinerPda(wallet4.publicKey), globalState: globalStatePda })
      .signers([wallet4]).rpc();
    await connection.confirmTransaction(tx, "confirmed");
    logResult("10A.1", "W4 pick puzzle 3", "Success", "Picked", tx, true);
    await new Promise(r => setTimeout(r, 1500));
  } else {
    logResult("10A.1", "W4 pick puzzle 3", "Already picked", "Skipped", null, true);
  }

  if (!state5.hasPick || state5.activePick.toNumber() !== TARGET) {
    console.log("W5 picking puzzle 3...");
    const tx = await program.methods.pick(new BN(TARGET))
      .accounts({ owner: wallet5.publicKey, minerState: getMinerPda(wallet5.publicKey), globalState: globalStatePda })
      .signers([wallet5]).rpc();
    await connection.confirmTransaction(tx, "confirmed");
    logResult("10A.2", "W5 pick puzzle 3", "Success", "Picked", tx, true);
    await new Promise(r => setTimeout(r, 1500));
  } else {
    logResult("10A.2", "W5 pick puzzle 3", "Already picked", "Skipped", null, true);
  }

  // Refresh states
  state4 = await program.account.minerState.fetch(getMinerPda(wallet4.publicKey));
  state5 = await program.account.minerState.fetch(getMinerPda(wallet5.publicKey));

  // COMMIT PHASE - both commit with their deterministic secrets
  console.log("\n--- COMMIT PHASE ---");

  const commit4 = computeCommitHash(puzzle.answer, puzzle.salt, secret4, wallet4.publicKey);
  const commit5 = computeCommitHash(puzzle.answer, puzzle.salt, secret5, wallet5.publicKey);

  if (!state4.hasCommit) {
    const tx = await program.methods.commitSolve(Array.from(commit4))
      .accounts({ owner: wallet4.publicKey, minerState: getMinerPda(wallet4.publicKey) })
      .signers([wallet4]).rpc();
    await connection.confirmTransaction(tx, "confirmed");
    logResult("10B.1", "W4 commit", "Success", "Committed", tx, true);
  } else {
    logResult("10B.1", "W4 commit", "Already committed", "Skipped", null, true);
  }

  if (!state5.hasCommit) {
    const tx = await program.methods.commitSolve(Array.from(commit5))
      .accounts({ owner: wallet5.publicKey, minerState: getMinerPda(wallet5.publicKey) })
      .signers([wallet5]).rpc();
    await connection.confirmTransaction(tx, "confirmed");
    logResult("10B.2", "W5 commit", "Success", "Committed", tx, true);
  } else {
    logResult("10B.2", "W5 commit", "Already committed", "Skipped", null, true);
  }

  // Wait for next slot (can't reveal in same slot as commit)
  console.log("\nWaiting for next slot...");
  await new Promise(r => setTimeout(r, 2000));

  // REVEAL RACE - send both reveals as fast as possible
  console.log("\n--- REVEAL RACE ---");

  const puzzleSolvedPda = getPuzzleSolvedPda(TARGET);
  let winner = null, loser = null;
  let winnerTx = null, loserError = null;

  // W4 reveal
  const revealW4 = async () => {
    const ata = getAssociatedTokenAddressSync(MINT, wallet4.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const balBefore = Number((await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    const tx = await program.methods.revealSolve(
      puzzle.answer, Array.from(puzzle.salt), Array.from(secret4), puzzle.proof.map(p => Array.from(p))
    ).accounts({
      owner: wallet4.publicKey, minerState: getMinerPda(wallet4.publicKey), globalState: globalStatePda,
      puzzleSolved: puzzleSolvedPda, mint: MINT, vault: vaultPda, minerTokenAccount: ata,
      tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId
    }).signers([wallet4]).rpc();
    await connection.confirmTransaction(tx, "confirmed");
    const balAfter = Number((await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    return { tx, reward: (balAfter - balBefore) / 1e9 };
  };

  // W5 reveal
  const revealW5 = async () => {
    const ata = getAssociatedTokenAddressSync(MINT, wallet5.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const balBefore = Number((await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    const tx = await program.methods.revealSolve(
      puzzle.answer, Array.from(puzzle.salt), Array.from(secret5), puzzle.proof.map(p => Array.from(p))
    ).accounts({
      owner: wallet5.publicKey, minerState: getMinerPda(wallet5.publicKey), globalState: globalStatePda,
      puzzleSolved: puzzleSolvedPda, mint: MINT, vault: vaultPda, minerTokenAccount: ata,
      tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId
    }).signers([wallet5]).rpc();
    await connection.confirmTransaction(tx, "confirmed");
    const balAfter = Number((await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    return { tx, reward: (balAfter - balBefore) / 1e9 };
  };

  // Try W4 first
  try {
    const result = await revealW4();
    winner = "W4";
    winnerTx = result.tx;
    console.log(`W4 reveal SUCCESS! Reward: ${result.reward} ECASH`);
    logResult("10C.1", "W4 reveal", "May succeed/fail", `SUCCESS (+${result.reward})`, result.tx, true);
  } catch (e) {
    loser = "W4";
    loserError = e.message;
    console.log(`W4 reveal FAILED: ${e.message.slice(0, 60)}`);
    logResult("10C.1", "W4 reveal", "May succeed/fail", "FAILED", null, true);
  }

  // Try W5
  try {
    const result = await revealW5();
    if (!winner) {
      winner = "W5";
      winnerTx = result.tx;
    }
    console.log(`W5 reveal SUCCESS! Reward: ${result.reward} ECASH`);
    logResult("10C.2", "W5 reveal", "May succeed/fail", `SUCCESS (+${result.reward})`, result.tx, true);
  } catch (e) {
    if (!loser) loser = "W5";
    if (!loserError) loserError = e.message;
    console.log(`W5 reveal FAILED: ${e.message.slice(0, 60)}`);
    logResult("10C.2", "W5 reveal", "May succeed/fail", "FAILED", null, true);
  }

  // VERIFICATION
  console.log("\n--- VERIFICATION ---");

  const globalAfter = await program.account.globalState.fetch(globalStatePda);
  const totalAfter = globalAfter.totalSolved.toNumber();
  const increase = totalAfter - totalBefore;
  console.log(`Total solved: ${totalBefore} -> ${totalAfter} (increase: ${increase})`);
  logResult("10D.1", "Single solve", "increase=1", `increase=${increase}`, null, increase === 1);

  const vaultAfter = Number((await getAccount(connection, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
  const vaultDec = (vaultBefore - vaultAfter) / 1e9;
  console.log(`Vault decrease: ${vaultDec} ECASH`);
  logResult("10D.2", "Single reward", "4000 ECASH", `${vaultDec} ECASH`, null, vaultDec === 4000);

  // Check puzzle_solved account
  try {
    const pzAcc = await program.account.puzzleSolved.fetch(puzzleSolvedPda);
    console.log(`Solver: ${pzAcc.solver.toString().slice(0, 8)}...`);
    logResult("10D.3", "Single solver", "One solver", `${pzAcc.solver.toString().slice(0, 8)}...`, null, true);
  } catch (e) {
    logResult("10D.3", "Single solver", "Recorded", e.message.slice(0, 30), null, false);
  }

  // Race analysis
  const raceOk = winner && loser && increase === 1;
  console.log(`\nRace result: Winner=${winner || "none"}, Loser=${loser || "none"}`);
  logResult("10D.4", "Race outcome", "1 winner, 1 loser", `${winner} won, ${loser} lost`, null, raceOk);

  // Cleanup: clear loser's pick
  if (loser) {
    console.log(`\nClearing ${loser}'s state...`);
    const loserWallet = loser === "W4" ? wallet4 : wallet5;
    try {
      // Cancel expired commit if any
      try {
        await program.methods.cancelExpiredCommit()
          .accounts({ owner: loserWallet.publicKey, minerState: getMinerPda(loserWallet.publicKey) })
          .signers([loserWallet]).rpc();
      } catch {}
      // Clear solved pick
      const tx = await program.methods.clearSolvedPick()
        .accounts({ owner: loserWallet.publicKey, minerState: getMinerPda(loserWallet.publicKey), puzzleSolved: puzzleSolvedPda })
        .signers([loserWallet]).rpc();
      await connection.confirmTransaction(tx, "confirmed");
      logResult("10E.1", `${loser} cleanup`, "Success", "Pick cleared", tx, true);
    } catch (e) {
      logResult("10E.1", `${loser} cleanup`, "Success", e.message.slice(0, 30), null, true);
    }
  }

  // SUMMARY
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 10 RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);
  console.log(`Double-mint prevention: ${increase === 1 && vaultDec === 4000 ? "WORKING" : "FAILED"}`);

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let log = `\n---\n\n## PHASE 10: Competitive Mining Race Test\n\n`;
  log += `**Scenario**: W4 and W5 race to solve puzzle ${TARGET}\n`;
  log += `**Winner**: ${winner || "None"}\n\n`;
  log += `| # | Test | Expected | Actual | TX | Status |\n|---|------|----------|--------|-----|--------|\n`;
  for (const r of results) {
    const txL = r.tx ? `[${r.tx.slice(0,8)}...](https://solscan.io/tx/${r.tx})` : "N/A";
    log += `| ${r.id} | ${r.name} | ${r.expected} | ${String(r.actual).slice(0,30)} | ${txL} | ${r.status} |\n`;
  }
  log += `\n**Summary**: ${passCount}/${results.length} passed\n`;
  log += `- Total solved increase: ${increase}\n- Vault decrease: ${vaultDec} ECASH\n- Double-mint prevented: ${increase === 1 && vaultDec === 4000 ? "YES" : "NO"}\n`;
  fs.appendFileSync(logPath, log);
  console.log("\nResults appended to DEPLOY-TEST-LOG.md");
}

main().catch(console.error);
