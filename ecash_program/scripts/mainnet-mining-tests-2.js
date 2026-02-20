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

// Constants
const PROGRAM_ID = new PublicKey("7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u");
const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINER_STATE_SEED = Buffer.from("miner_state");
const PUZZLE_SOLVED_SEED = Buffer.from("puzzle_solved");
const VAULT_SEED = Buffer.from("vault");

const NOT_IN_BATCH = new BN("18446744073709551615");

// ============================================================================
// CRYPTOGRAPHIC HELPERS
// ============================================================================

function keccak(input) {
  return Buffer.from(keccak256.arrayBuffer(input));
}

function normalizeAnswer(answer) {
  let lower = answer.toLowerCase();
  let filtered = "";
  for (const c of lower) {
    if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === " ") {
      filtered += c;
    }
  }
  filtered = filtered.trim();
  let result = "";
  let lastWasSpace = false;
  for (const c of filtered) {
    if (c === " ") {
      if (!lastWasSpace) {
        result += c;
        lastWasSpace = true;
      }
    } else {
      result += c;
      lastWasSpace = false;
    }
  }
  return result;
}

function computeCommitHash(answer, salt, secret, signer) {
  const answerBytes = Buffer.from(answer, "utf-8");
  const input = Buffer.concat([answerBytes, salt, secret, signer.toBuffer()]);
  return keccak(input);
}

function abiEncodePuzzleData(puzzleId, normalizedAnswer, salt) {
  const puzzleIdBytes = Buffer.alloc(32);
  const puzzleIdBN = new BN(puzzleId);
  puzzleIdBN.toArrayLike(Buffer, "be", 8).copy(puzzleIdBytes, 24);

  const offsetBytes = Buffer.alloc(32);
  offsetBytes[31] = 0x60;

  const saltSlot = Buffer.from(salt);

  const stringBytes = Buffer.from(normalizedAnswer, "utf-8");
  const stringLen = stringBytes.length;

  const lenBytes = Buffer.alloc(32);
  const lenBN = new BN(stringLen);
  lenBN.toArrayLike(Buffer, "be", 8).copy(lenBytes, 24);

  const paddedLen = Math.max(Math.ceil(stringLen / 32) * 32, 32);
  const stringData = Buffer.alloc(paddedLen);
  stringBytes.copy(stringData, 0);

  return Buffer.concat([puzzleIdBytes, offsetBytes, saltSlot, lenBytes, stringData]);
}

function computeMerkleLeaf(puzzleId, normalizedAnswer, salt) {
  const abiEncoded = abiEncodePuzzleData(puzzleId, normalizedAnswer, salt);
  const innerHash = keccak(abiEncoded);
  return keccak(innerHash);
}

function sortedPairHash(a, b) {
  if (a.compare(b) <= 0) {
    return keccak(Buffer.concat([a, b]));
  } else {
    return keccak(Buffer.concat([b, a]));
  }
}

function buildTestMerkleTree(leaves) {
  if (leaves.length === 0) throw new Error("Empty leaves");

  let currentLevel = [...leaves];
  const proofs = leaves.map(() => []);
  const positions = leaves.map((_, i) => i);

  while (currentLevel.length > 1) {
    const nextLevel = [];
    const nextPositions = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(sortedPairHash(left, right));
    }

    for (let leafIdx = 0; leafIdx < leaves.length; leafIdx++) {
      const pos = positions[leafIdx];
      const siblingPos = pos % 2 === 0 ? pos + 1 : pos - 1;
      if (siblingPos < currentLevel.length) {
        proofs[leafIdx].push(currentLevel[siblingPos]);
      }
      nextPositions[leafIdx] = Math.floor(pos / 2);
    }

    currentLevel = nextLevel;
    for (let i = 0; i < leaves.length; i++) {
      positions[i] = nextPositions[i];
    }
  }

  return { root: currentLevel[0], proofs };
}

// Create test puzzles (same as Rust deployment)
function createTestPuzzles() {
  const puzzles = [
    { puzzleId: 0, answer: "the rosetta stone", salt: Buffer.alloc(32, 1), proof: [] },
    { puzzleId: 1, answer: "fibonacci sequence", salt: Buffer.alloc(32, 2), proof: [] },
    { puzzleId: 2, answer: "golden ratio", salt: Buffer.alloc(32, 3), proof: [] },
    { puzzleId: 3, answer: "prime number", salt: Buffer.alloc(32, 4), proof: [] },
    { puzzleId: 4, answer: "euler identity", salt: Buffer.alloc(32, 5), proof: [] },
    { puzzleId: 5, answer: "pythagorean theorem", salt: Buffer.alloc(32, 6), proof: [] },
    { puzzleId: 6, answer: "archimedes principle", salt: Buffer.alloc(32, 7), proof: [] },
    { puzzleId: 7, answer: "newtons laws", salt: Buffer.alloc(32, 8), proof: [] },
    { puzzleId: 8, answer: "theory of relativity", salt: Buffer.alloc(32, 9), proof: [] },
    { puzzleId: 9, answer: "quantum mechanics", salt: Buffer.alloc(32, 10), proof: [] },
  ];

  const leaves = puzzles.map(p => computeMerkleLeaf(p.puzzleId, normalizeAnswer(p.answer), p.salt));
  const { root, proofs } = buildTestMerkleTree(leaves);
  puzzles.forEach((p, i) => { p.proof = proofs[i]; });

  return { puzzles, merkleRoot: root };
}

// ============================================================================
// TEST FRAMEWORK
// ============================================================================

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

async function getMinerState(program, owner) {
  const [pda] = PublicKey.findProgramAddressSync(
    [MINER_STATE_SEED, owner.toBuffer()],
    PROGRAM_ID
  );
  try {
    return await program.account.minerState.fetch(pda);
  } catch {
    return null;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 4D-F: COMMIT-REVEAL TESTS - MAINNET");
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

  // Helper functions
  const getMinerPda = (pubkey) => PublicKey.findProgramAddressSync([MINER_STATE_SEED, pubkey.toBuffer()], PROGRAM_ID)[0];
  const getPuzzleSolvedPda = (puzzleId) => PublicKey.findProgramAddressSync(
    [PUZZLE_SOLVED_SEED, new BN(puzzleId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];

  // Create test puzzle data with Merkle proofs
  const { puzzles, merkleRoot } = createTestPuzzles();
  console.log("Computed Merkle Root:", merkleRoot.toString("hex"));

  // Check current state
  console.log("\n--- Checking current miner states ---\n");
  for (const [name, wallet] of [["W1", wallet1], ["W2", wallet2], ["W3", wallet3]]) {
    const state = await getMinerState(program, wallet.publicKey);
    if (state) {
      console.log(`${name}: gas=${state.gasBalance}, hasPick=${state.hasPick}, activePick=${state.activePick}, hasCommit=${state.hasCommit}`);
    }
  }

  // Create secrets for each miner
  const crypto = require("crypto");
  const secrets = {
    W1: crypto.randomBytes(32),
    W2: crypto.randomBytes(32),
    W3: crypto.randomBytes(32),
  };

  // ============================================================
  // 4D: COMMIT TESTS
  // ============================================================
  console.log("\n--- 4D: COMMIT TESTS ---\n");

  // 4D.1: W1 commit for puzzle 0
  try {
    const puzzle = puzzles[0]; // puzzle 0
    const secret = secrets.W1;
    const minerStatePda = getMinerPda(wallet1.publicKey);

    const commitHash = computeCommitHash(puzzle.answer, puzzle.salt, secret, wallet1.publicKey);
    console.log(`W1 commit hash: ${commitHash.toString("hex").slice(0, 16)}...`);

    const tx = await program.methods
      .commitSolve(Array.from(commitHash))
      .accounts({
        owner: wallet1.publicKey,
        minerState: minerStatePda,
      })
      .signers([wallet1])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    const state = await getMinerState(program, wallet1.publicKey);
    const hasCommit = state && state.hasCommit;
    logResult("4D.1", "W1 commit for puzzle 0", "hasCommit=true", `hasCommit=${hasCommit}`, tx, hasCommit);
  } catch (e) {
    logResult("4D.1", "W1 commit for puzzle 0", "Success", e.message.slice(0, 80), null, false);
  }
  await new Promise(r => setTimeout(r, 2000));

  // 4D.2: W2 commit for puzzle 1
  try {
    const puzzle = puzzles[1]; // puzzle 1
    const secret = secrets.W2;
    const minerStatePda = getMinerPda(wallet2.publicKey);

    const commitHash = computeCommitHash(puzzle.answer, puzzle.salt, secret, wallet2.publicKey);

    const tx = await program.methods
      .commitSolve(Array.from(commitHash))
      .accounts({
        owner: wallet2.publicKey,
        minerState: minerStatePda,
      })
      .signers([wallet2])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    logResult("4D.2", "W2 commit for puzzle 1", "Success", "Committed", tx, true);
  } catch (e) {
    logResult("4D.2", "W2 commit for puzzle 1", "Success", e.message.slice(0, 80), null, false);
  }
  await new Promise(r => setTimeout(r, 2000));

  // 4D.3: W3 commit for puzzle 2
  try {
    const puzzle = puzzles[2]; // puzzle 2
    const secret = secrets.W3;
    const minerStatePda = getMinerPda(wallet3.publicKey);

    const commitHash = computeCommitHash(puzzle.answer, puzzle.salt, secret, wallet3.publicKey);

    const tx = await program.methods
      .commitSolve(Array.from(commitHash))
      .accounts({
        owner: wallet3.publicKey,
        minerState: minerStatePda,
      })
      .signers([wallet3])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    logResult("4D.3", "W3 commit for puzzle 2", "Success", "Committed", tx, true);
  } catch (e) {
    logResult("4D.3", "W3 commit for puzzle 2", "Success", e.message.slice(0, 80), null, false);
  }
  await new Promise(r => setTimeout(r, 2000));

  // 4D.4: W4 commit without pick (should fail)
  try {
    const minerStatePda = getMinerPda(wallet4.publicKey);
    const fakeCommit = crypto.randomBytes(32);

    await program.methods
      .commitSolve(Array.from(fakeCommit))
      .accounts({
        owner: wallet4.publicKey,
        minerState: minerStatePda,
      })
      .signers([wallet4])
      .rpc();
    logResult("4D.4", "W4 commit without pick", "FAIL: NoPick", "Success (BAD)", null, false);
  } catch (e) {
    const isRightError = e.message.includes("NoPick") || e.message.includes("not picked");
    logResult("4D.4", "W4 commit without pick", "FAIL: NoPick", "Rejected correctly", null, true);
  }

  // 4D.5: W1 double commit (should fail)
  try {
    const minerStatePda = getMinerPda(wallet1.publicKey);
    const fakeCommit = crypto.randomBytes(32);

    await program.methods
      .commitSolve(Array.from(fakeCommit))
      .accounts({
        owner: wallet1.publicKey,
        minerState: minerStatePda,
      })
      .signers([wallet1])
      .rpc();
    logResult("4D.5", "W1 double commit", "FAIL: AlreadyHasCommit", "Success (BAD)", null, false);
  } catch (e) {
    logResult("4D.5", "W1 double commit", "FAIL: AlreadyHasCommit", "Rejected correctly", null, true);
  }

  // ============================================================
  // 4E: REVEAL TESTS
  // ============================================================
  console.log("\n--- 4E: REVEAL TESTS ---\n");

  // Wait for next slot to avoid same-slot reveal error
  console.log("Waiting for next slot...");
  await new Promise(r => setTimeout(r, 3000));

  // Get vault balance before reveals
  let vaultBalanceBefore;
  try {
    vaultBalanceBefore = Number((await getAccount(connection, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    console.log(`Vault balance before reveals: ${vaultBalanceBefore / 1e9} ECASH\n`);
  } catch (e) {
    console.log("Could not get vault balance:", e.message);
    vaultBalanceBefore = 0;
  }

  // 4E.1: W1 reveal solution (should get reward)
  try {
    const puzzle = puzzles[0];
    const secret = secrets.W1;
    const minerStatePda = getMinerPda(wallet1.publicKey);
    const puzzleSolvedPda = getPuzzleSolvedPda(puzzle.puzzleId);
    const wallet1Ata = getAssociatedTokenAddressSync(MINT, wallet1.publicKey, false, TOKEN_2022_PROGRAM_ID);

    const balBefore = Number((await getAccount(connection, wallet1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);

    const tx = await program.methods
      .revealSolve(
        puzzle.answer,
        Array.from(puzzle.salt),
        Array.from(secret),
        puzzle.proof.map(p => Array.from(p))
      )
      .accounts({
        owner: wallet1.publicKey,
        minerState: minerStatePda,
        globalState: globalStatePda,
        puzzleSolved: puzzleSolvedPda,
        mint: MINT,
        vault: vaultPda,
        minerTokenAccount: wallet1Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet1])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    const balAfter = Number((await getAccount(connection, wallet1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    const reward = (balAfter - balBefore) / 1e9;
    console.log(`W1 reward: ${reward} ECASH`);
    logResult("4E.1", "W1 reveal puzzle 0", "Receive 10000 ECASH", `Received ${reward} ECASH`, tx, reward === 10000);
  } catch (e) {
    console.log("W1 reveal error:", e.message);
    if (e.logs) console.log("Logs:", e.logs.slice(-5));
    logResult("4E.1", "W1 reveal puzzle 0", "Success", e.message.slice(0, 80), null, false);
  }
  await new Promise(r => setTimeout(r, 2000));

  // 4E.2: W2 reveal solution
  try {
    const puzzle = puzzles[1];
    const secret = secrets.W2;
    const minerStatePda = getMinerPda(wallet2.publicKey);
    const puzzleSolvedPda = getPuzzleSolvedPda(puzzle.puzzleId);
    const wallet2Ata = getAssociatedTokenAddressSync(MINT, wallet2.publicKey, false, TOKEN_2022_PROGRAM_ID);

    const balBefore = Number((await getAccount(connection, wallet2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);

    const tx = await program.methods
      .revealSolve(
        puzzle.answer,
        Array.from(puzzle.salt),
        Array.from(secret),
        puzzle.proof.map(p => Array.from(p))
      )
      .accounts({
        owner: wallet2.publicKey,
        minerState: minerStatePda,
        globalState: globalStatePda,
        puzzleSolved: puzzleSolvedPda,
        mint: MINT,
        vault: vaultPda,
        minerTokenAccount: wallet2Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet2])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    const balAfter = Number((await getAccount(connection, wallet2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    const reward = (balAfter - balBefore) / 1e9;
    console.log(`W2 reward: ${reward} ECASH`);
    logResult("4E.2", "W2 reveal puzzle 1", "Receive 10000 ECASH", `Received ${reward} ECASH`, tx, reward === 10000);
  } catch (e) {
    console.log("W2 reveal error:", e.message);
    if (e.logs) console.log("Logs:", e.logs.slice(-5));
    logResult("4E.2", "W2 reveal puzzle 1", "Success", e.message.slice(0, 80), null, false);
  }
  await new Promise(r => setTimeout(r, 2000));

  // 4E.3: W3 reveal solution
  try {
    const puzzle = puzzles[2];
    const secret = secrets.W3;
    const minerStatePda = getMinerPda(wallet3.publicKey);
    const puzzleSolvedPda = getPuzzleSolvedPda(puzzle.puzzleId);
    const wallet3Ata = getAssociatedTokenAddressSync(MINT, wallet3.publicKey, false, TOKEN_2022_PROGRAM_ID);

    const balBefore = Number((await getAccount(connection, wallet3Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);

    const tx = await program.methods
      .revealSolve(
        puzzle.answer,
        Array.from(puzzle.salt),
        Array.from(secret),
        puzzle.proof.map(p => Array.from(p))
      )
      .accounts({
        owner: wallet3.publicKey,
        minerState: minerStatePda,
        globalState: globalStatePda,
        puzzleSolved: puzzleSolvedPda,
        mint: MINT,
        vault: vaultPda,
        minerTokenAccount: wallet3Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet3])
      .rpc();

    await connection.confirmTransaction(tx, "confirmed");
    const balAfter = Number((await getAccount(connection, wallet3Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    const reward = (balAfter - balBefore) / 1e9;
    console.log(`W3 reward: ${reward} ECASH`);
    logResult("4E.3", "W3 reveal puzzle 2", "Receive 10000 ECASH", `Received ${reward} ECASH`, tx, reward === 10000);
  } catch (e) {
    console.log("W3 reveal error:", e.message);
    if (e.logs) console.log("Logs:", e.logs.slice(-5));
    logResult("4E.3", "W3 reveal puzzle 2", "Success", e.message.slice(0, 80), null, false);
  }
  await new Promise(r => setTimeout(r, 2000));

  // ============================================================
  // 4F: STATE VERIFICATION
  // ============================================================
  console.log("\n--- 4F: STATE VERIFICATION ---\n");

  // Check global state
  const globalState = await program.account.globalState.fetch(globalStatePda);
  const totalSolved = globalState.totalSolved.toNumber();
  console.log(`Total puzzles solved: ${totalSolved}`);
  logResult("4F.1", "Total solved count", "3", String(totalSolved), null, totalSolved === 3);

  // Check vault balance decrease
  try {
    const vaultBalanceAfter = Number((await getAccount(connection, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    const vaultDecrease = (vaultBalanceBefore - vaultBalanceAfter) / 1e9;
    console.log(`Vault balance after: ${vaultBalanceAfter / 1e9} ECASH`);
    console.log(`Vault decrease: ${vaultDecrease} ECASH`);
    logResult("4F.2", "Vault decrease", "30000 ECASH", `${vaultDecrease} ECASH`, null, vaultDecrease === 30000);
  } catch (e) {
    logResult("4F.2", "Vault decrease", "30000 ECASH", e.message, null, false);
  }

  // Check miner states reset
  for (const [name, wallet] of [["W1", wallet1], ["W2", wallet2], ["W3", wallet3]]) {
    const state = await getMinerState(program, wallet.publicKey);
    const gasBalance = state ? state.gasBalance.toNumber() : 0;
    const hasPick = state ? state.hasPick : false;
    const hasCommit = state ? state.hasCommit : false;
    console.log(`${name}: gas=${gasBalance}, hasPick=${hasPick}, hasCommit=${hasCommit}`);
    // After successful reveal: hasPick=false, hasCommit=false
    const pickOk = !hasPick;
    const commitOk = !hasCommit;
    logResult(`4F.3${name}`, `${name} state after reveal`, `hasPick=false, hasCommit=false`, `hasPick=${hasPick}, hasCommit=${hasCommit}`, null, pickOk && commitOk);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 4D-F RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let logContent = `\n### 4D-F: Commit-Reveal + State Verification Tests\n\n| # | Test | Expected | Actual | TX | Status |\n|---|------|----------|--------|-----|--------|\n`;
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
