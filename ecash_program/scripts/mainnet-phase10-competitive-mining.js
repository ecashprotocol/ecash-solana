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
const crypto = require("crypto");

// Constants
const PROGRAM_ID = new PublicKey("7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u");
const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINER_STATE_SEED = Buffer.from("miner_state");
const PUZZLE_SOLVED_SEED = Buffer.from("puzzle_solved");
const VAULT_SEED = Buffer.from("vault");

const NOT_IN_BATCH = new BN("18446744073709551615");

// ============================================================================
// CRYPTOGRAPHIC HELPERS (same as mining-tests-2)
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
  console.log("  PHASE 10: COMPETITIVE MINING TEST - RACE CONDITION");
  console.log("=".repeat(60));

  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const deployer = await loadWallet("deployer");
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

  const { puzzles, merkleRoot } = createTestPuzzles();

  // Use puzzle 3 for the competitive test (puzzles 0,1,2 already solved)
  const TARGET_PUZZLE = 3;
  const puzzle = puzzles[TARGET_PUZZLE];

  console.log(`\nTarget puzzle: ${TARGET_PUZZLE} (answer: "${puzzle.answer}")`);
  console.log(`Contestants: W4 and W5\n`);

  // Check if puzzle 3 is already solved
  try {
    const puzzleSolvedPda = getPuzzleSolvedPda(TARGET_PUZZLE);
    await program.account.puzzleSolved.fetch(puzzleSolvedPda);
    console.log("WARNING: Puzzle 3 already solved! Using next unsolved puzzle.");
    logResult("10.0", "Puzzle 3 availability", "Unsolved", "Already solved", null, false);
    console.log("\nSkipping Phase 10 - cannot test race condition on solved puzzle.");
    return;
  } catch (e) {
    console.log("Puzzle 3 is unsolved - proceeding with race test\n");
    logResult("10.0", "Puzzle 3 availability", "Unsolved", "Available", null, true);
  }

  // Check initial state
  console.log("--- Initial State ---\n");
  const globalStateBefore = await program.account.globalState.fetch(globalStatePda);
  const totalSolvedBefore = globalStateBefore.totalSolved.toNumber();
  console.log(`Total solved before: ${totalSolvedBefore}`);

  // Get vault balance before
  const vaultBalanceBefore = Number((await getAccount(connection, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
  console.log(`Vault balance before: ${vaultBalanceBefore / 1e9} ECASH\n`);

  // ============================================================
  // 10A: SETUP - Both wallets enter batch and pick same puzzle
  // ============================================================
  console.log("--- 10A: SETUP - Both miners targeting puzzle 3 ---\n");

  // W4 enter batch (if needed)
  let w4State = await getMinerState(program, wallet4.publicKey);
  if (!w4State || w4State.enteredBatch.eq(NOT_IN_BATCH)) {
    try {
      const minerStatePda = getMinerPda(wallet4.publicKey);
      const wallet4Ata = getAssociatedTokenAddressSync(MINT, wallet4.publicKey, false, TOKEN_2022_PROGRAM_ID);

      const tx = await program.methods
        .enterBatch()
        .accounts({
          owner: wallet4.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
          mint: MINT,
          minerTokenAccount: wallet4Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([wallet4])
        .rpc();
      await connection.confirmTransaction(tx, "confirmed");
      logResult("10A.1", "W4 enter batch", "Success", "Entered batch 0", tx, true);
    } catch (e) {
      logResult("10A.1", "W4 enter batch", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  } else {
    logResult("10A.1", "W4 enter batch", "Already in batch", "Skipped", null, true);
  }

  // W5 enter batch (if needed)
  let w5State = await getMinerState(program, wallet5.publicKey);
  if (!w5State || w5State.enteredBatch.eq(NOT_IN_BATCH)) {
    try {
      const minerStatePda = getMinerPda(wallet5.publicKey);
      const wallet5Ata = getAssociatedTokenAddressSync(MINT, wallet5.publicKey, false, TOKEN_2022_PROGRAM_ID);

      const tx = await program.methods
        .enterBatch()
        .accounts({
          owner: wallet5.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
          mint: MINT,
          minerTokenAccount: wallet5Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([wallet5])
        .rpc();
      await connection.confirmTransaction(tx, "confirmed");
      logResult("10A.2", "W5 enter batch", "Success", "Entered batch 0", tx, true);
    } catch (e) {
      logResult("10A.2", "W5 enter batch", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  } else {
    logResult("10A.2", "W5 enter batch", "Already in batch", "Skipped", null, true);
  }

  // W4 pick puzzle 3 (if no active pick)
  w4State = await getMinerState(program, wallet4.publicKey);
  if (!w4State?.hasPick) {
    try {
      const minerStatePda = getMinerPda(wallet4.publicKey);
      const tx = await program.methods
        .pick(new BN(TARGET_PUZZLE))
        .accounts({
          owner: wallet4.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
        })
        .signers([wallet4])
        .rpc();
      await connection.confirmTransaction(tx, "confirmed");
      logResult("10A.3", "W4 pick puzzle 3", "Success", "Picked puzzle 3", tx, true);
    } catch (e) {
      logResult("10A.3", "W4 pick puzzle 3", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  } else if (w4State.activePick.toNumber() === TARGET_PUZZLE) {
    logResult("10A.3", "W4 pick puzzle 3", "Already has pick 3", "Skipped", null, true);
  } else {
    logResult("10A.3", "W4 pick puzzle 3", "Puzzle 3", `Has different pick: ${w4State.activePick}`, null, false);
  }

  // W5 pick puzzle 3 (if no active pick)
  w5State = await getMinerState(program, wallet5.publicKey);
  if (!w5State?.hasPick) {
    try {
      const minerStatePda = getMinerPda(wallet5.publicKey);
      const tx = await program.methods
        .pick(new BN(TARGET_PUZZLE))
        .accounts({
          owner: wallet5.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
        })
        .signers([wallet5])
        .rpc();
      await connection.confirmTransaction(tx, "confirmed");
      logResult("10A.4", "W5 pick puzzle 3", "Success", "Picked puzzle 3", tx, true);
    } catch (e) {
      logResult("10A.4", "W5 pick puzzle 3", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  } else if (w5State.activePick.toNumber() === TARGET_PUZZLE) {
    logResult("10A.4", "W5 pick puzzle 3", "Already has pick 3", "Skipped", null, true);
  } else {
    logResult("10A.4", "W5 pick puzzle 3", "Puzzle 3", `Has different pick: ${w5State.activePick}`, null, false);
  }

  // ============================================================
  // 10B: COMMIT - Both wallets commit solutions
  // ============================================================
  console.log("\n--- 10B: COMMIT - Both miners commit solutions ---\n");

  const secret4 = crypto.randomBytes(32);
  const secret5 = crypto.randomBytes(32);

  // W4 commit
  w4State = await getMinerState(program, wallet4.publicKey);
  if (w4State?.hasPick && !w4State?.hasCommit) {
    try {
      const minerStatePda = getMinerPda(wallet4.publicKey);
      const commitHash = computeCommitHash(puzzle.answer, puzzle.salt, secret4, wallet4.publicKey);

      const tx = await program.methods
        .commitSolve(Array.from(commitHash))
        .accounts({
          owner: wallet4.publicKey,
          minerState: minerStatePda,
        })
        .signers([wallet4])
        .rpc();
      await connection.confirmTransaction(tx, "confirmed");
      logResult("10B.1", "W4 commit solution", "Success", "Committed", tx, true);
    } catch (e) {
      logResult("10B.1", "W4 commit solution", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  } else if (w4State?.hasCommit) {
    logResult("10B.1", "W4 commit solution", "Already committed", "Skipped", null, true);
  }

  // W5 commit
  w5State = await getMinerState(program, wallet5.publicKey);
  if (w5State?.hasPick && !w5State?.hasCommit) {
    try {
      const minerStatePda = getMinerPda(wallet5.publicKey);
      const commitHash = computeCommitHash(puzzle.answer, puzzle.salt, secret5, wallet5.publicKey);

      const tx = await program.methods
        .commitSolve(Array.from(commitHash))
        .accounts({
          owner: wallet5.publicKey,
          minerState: minerStatePda,
        })
        .signers([wallet5])
        .rpc();
      await connection.confirmTransaction(tx, "confirmed");
      logResult("10B.2", "W5 commit solution", "Success", "Committed", tx, true);
    } catch (e) {
      logResult("10B.2", "W5 commit solution", "Success", e.message.slice(0, 60), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  } else if (w5State?.hasCommit) {
    logResult("10B.2", "W5 commit solution", "Already committed", "Skipped", null, true);
  }

  // ============================================================
  // 10C: REVEAL RACE - First one wins, second one fails
  // ============================================================
  console.log("\n--- 10C: REVEAL RACE - Testing double-mint prevention ---\n");

  console.log("Waiting for next slot...");
  await new Promise(r => setTimeout(r, 3000));

  const puzzleSolvedPda = getPuzzleSolvedPda(TARGET_PUZZLE);
  let firstWinner = null;
  let w4RevealTx = null;
  let w5RevealTx = null;
  let w4RevealError = null;
  let w5RevealError = null;

  // Try W4 reveal first
  w4State = await getMinerState(program, wallet4.publicKey);
  if (w4State?.hasCommit && w4State?.activePick.toNumber() === TARGET_PUZZLE) {
    try {
      const minerStatePda = getMinerPda(wallet4.publicKey);
      const wallet4Ata = getAssociatedTokenAddressSync(MINT, wallet4.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const balBefore = Number((await getAccount(connection, wallet4Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);

      const tx = await program.methods
        .revealSolve(
          puzzle.answer,
          Array.from(puzzle.salt),
          Array.from(secret4),
          puzzle.proof.map(p => Array.from(p))
        )
        .accounts({
          owner: wallet4.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
          puzzleSolved: puzzleSolvedPda,
          mint: MINT,
          vault: vaultPda,
          minerTokenAccount: wallet4Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet4])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      const balAfter = Number((await getAccount(connection, wallet4Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
      const reward = (balAfter - balBefore) / 1e9;
      firstWinner = "W4";
      w4RevealTx = tx;
      console.log(`W4 reveal SUCCESS! Reward: ${reward} ECASH`);
      logResult("10C.1", "W4 reveal attempt", "May succeed or fail", `SUCCESS (+${reward} ECASH)`, tx, true);
    } catch (e) {
      w4RevealError = e.message;
      console.log(`W4 reveal FAILED: ${e.message.slice(0, 60)}`);
      logResult("10C.1", "W4 reveal attempt", "May succeed or fail", `FAILED: ${e.message.slice(0, 40)}`, null, true);
    }
  } else {
    logResult("10C.1", "W4 reveal attempt", "Has commit", "No commit or wrong puzzle", null, false);
  }

  await new Promise(r => setTimeout(r, 2000));

  // Try W5 reveal
  w5State = await getMinerState(program, wallet5.publicKey);
  if (w5State?.hasCommit && w5State?.activePick.toNumber() === TARGET_PUZZLE) {
    try {
      const minerStatePda = getMinerPda(wallet5.publicKey);
      const wallet5Ata = getAssociatedTokenAddressSync(MINT, wallet5.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const balBefore = Number((await getAccount(connection, wallet5Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);

      const tx = await program.methods
        .revealSolve(
          puzzle.answer,
          Array.from(puzzle.salt),
          Array.from(secret5),
          puzzle.proof.map(p => Array.from(p))
        )
        .accounts({
          owner: wallet5.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
          puzzleSolved: puzzleSolvedPda,
          mint: MINT,
          vault: vaultPda,
          minerTokenAccount: wallet5Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet5])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      const balAfter = Number((await getAccount(connection, wallet5Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
      const reward = (balAfter - balBefore) / 1e9;
      if (!firstWinner) firstWinner = "W5";
      w5RevealTx = tx;
      console.log(`W5 reveal SUCCESS! Reward: ${reward} ECASH`);
      logResult("10C.2", "W5 reveal attempt", "May succeed or fail", `SUCCESS (+${reward} ECASH)`, tx, true);
    } catch (e) {
      w5RevealError = e.message;
      console.log(`W5 reveal FAILED: ${e.message.slice(0, 60)}`);
      logResult("10C.2", "W5 reveal attempt", "May succeed or fail", `FAILED: ${e.message.slice(0, 40)}`, null, true);
    }
  } else {
    logResult("10C.2", "W5 reveal attempt", "Has commit", "No commit or wrong puzzle", null, false);
  }

  // ============================================================
  // 10D: VERIFICATION - Check no double-mint occurred
  // ============================================================
  console.log("\n--- 10D: VERIFICATION - Checking for double-mint ---\n");

  // Check global state - total solved should only increase by 1
  const globalStateAfter = await program.account.globalState.fetch(globalStatePda);
  const totalSolvedAfter = globalStateAfter.totalSolved.toNumber();
  const solvedIncrease = totalSolvedAfter - totalSolvedBefore;
  console.log(`Total solved before: ${totalSolvedBefore}, after: ${totalSolvedAfter}`);
  console.log(`Increase: ${solvedIncrease}`);

  const correctIncrease = solvedIncrease === 1;
  logResult("10D.1", "Total solved increase", "1 (no double-solve)", String(solvedIncrease), null, correctIncrease);

  // Check vault balance - should only decrease by one reward (4000 ECASH for Era 1)
  const vaultBalanceAfter = Number((await getAccount(connection, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
  const vaultDecrease = (vaultBalanceBefore - vaultBalanceAfter) / 1e9;
  console.log(`Vault decrease: ${vaultDecrease} ECASH`);

  const correctVaultDecrease = vaultDecrease === 4000; // Era 1 reward
  logResult("10D.2", "Vault decrease", "4000 ECASH (one reward)", `${vaultDecrease} ECASH`, null, correctVaultDecrease);

  // Check puzzle_solved PDA has exactly one solver
  try {
    const puzzleSolvedAccount = await program.account.puzzleSolved.fetch(puzzleSolvedPda);
    const solver = puzzleSolvedAccount.solver.toString();
    console.log(`Puzzle solved by: ${solver.slice(0, 8)}...`);
    logResult("10D.3", "Single solver recorded", "One solver", `Solver: ${solver.slice(0, 8)}...`, null, true);
  } catch (e) {
    logResult("10D.3", "Single solver recorded", "Solver recorded", e.message.slice(0, 40), null, false);
  }

  // Race outcome analysis
  console.log("\n--- RACE OUTCOME ---\n");
  let raceOutcomeCorrect = false;
  if (firstWinner && (w4RevealError || w5RevealError)) {
    // Exactly one succeeded, one failed - this is correct
    console.log(`Winner: ${firstWinner}`);
    console.log(`Loser's error: ${w4RevealError || w5RevealError}`);
    raceOutcomeCorrect = true;
    logResult("10D.4", "Race outcome", "One winner, one loser", `${firstWinner} won`, null, true);
  } else if (!firstWinner) {
    // Neither succeeded - both may have already committed/revealed before
    console.log("Neither wallet could reveal - check state");
    logResult("10D.4", "Race outcome", "One winner, one loser", "Neither could reveal", null, false);
  } else if (w4RevealTx && w5RevealTx) {
    // CRITICAL BUG: Both succeeded
    console.log("CRITICAL: BOTH REVEALS SUCCEEDED - DOUBLE MINT BUG!");
    logResult("10D.4", "Race outcome", "One winner, one loser", "DOUBLE MINT BUG!", null, false);
  }

  // ============================================================
  // 10E: CLEANUP - Clear loser's state (if needed)
  // ============================================================
  console.log("\n--- 10E: CLEANUP ---\n");

  // If W5 lost, they should be able to clear their pick
  if (firstWinner === "W4" && w5RevealError) {
    try {
      const minerStatePda = getMinerPda(wallet5.publicKey);

      // First cancel expired commit
      try {
        const tx1 = await program.methods
          .cancelExpiredCommit()
          .accounts({
            owner: wallet5.publicKey,
            minerState: minerStatePda,
          })
          .signers([wallet5])
          .rpc();
        await connection.confirmTransaction(tx1, "confirmed");
        console.log("W5 commit cancelled");
      } catch (e) {
        // May not be expired yet, or already cancelled
      }

      // Then clear solved pick
      const tx2 = await program.methods
        .clearSolvedPick()
        .accounts({
          owner: wallet5.publicKey,
          minerState: minerStatePda,
          puzzleSolved: puzzleSolvedPda,
        })
        .signers([wallet5])
        .rpc();
      await connection.confirmTransaction(tx2, "confirmed");
      logResult("10E.1", "W5 clear solved pick", "Success", "Pick cleared", tx2, true);
    } catch (e) {
      logResult("10E.1", "W5 clear solved pick", "Success or N/A", e.message.slice(0, 40), null, true);
    }
  } else if (firstWinner === "W5" && w4RevealError) {
    try {
      const minerStatePda = getMinerPda(wallet4.publicKey);

      try {
        await program.methods
          .cancelExpiredCommit()
          .accounts({
            owner: wallet4.publicKey,
            minerState: minerStatePda,
          })
          .signers([wallet4])
          .rpc();
      } catch (e) {
        // May not be expired yet
      }

      const tx2 = await program.methods
        .clearSolvedPick()
        .accounts({
          owner: wallet4.publicKey,
          minerState: minerStatePda,
          puzzleSolved: puzzleSolvedPda,
        })
        .signers([wallet4])
        .rpc();
      await connection.confirmTransaction(tx2, "confirmed");
      logResult("10E.1", "W4 clear solved pick", "Success", "Pick cleared", tx2, true);
    } catch (e) {
      logResult("10E.1", "W4 clear solved pick", "Success or N/A", e.message.slice(0, 40), null, true);
    }
  } else {
    logResult("10E.1", "Loser cleanup", "N/A", "Skipped", null, true);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 10 RESULTS - COMPETITIVE MINING TEST");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);
  console.log(`\nRace Condition Prevention: ${raceOutcomeCorrect ? "WORKING" : "FAILED"}`);
  console.log(`Double-Mint Prevention: ${correctIncrease && correctVaultDecrease ? "WORKING" : "FAILED"}`);

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let logContent = `\n---\n\n## PHASE 10: Competitive Mining Test\n\n`;
  logContent += `**Scenario**: W4 and W5 race to solve puzzle ${TARGET_PUZZLE}\n\n`;
  logContent += `| # | Test | Expected | Actual | TX | Status |\n`;
  logContent += `|---|------|----------|--------|-----|--------|\n`;
  for (const r of results) {
    const txLink = r.txSig ? `[${r.txSig.slice(0,8)}...](https://solscan.io/tx/${r.txSig})` : "N/A";
    logContent += `| ${r.testId} | ${r.testName} | ${r.expected} | ${r.actual.slice(0,30)} | ${txLink} | ${r.status} |\n`;
  }
  logContent += `\n**Summary**: ${passCount}/${results.length} passed\n`;
  logContent += `\n### Race Analysis\n`;
  logContent += `- Winner: ${firstWinner || "None"}\n`;
  logContent += `- Total solved increase: ${solvedIncrease}\n`;
  logContent += `- Vault decrease: ${vaultDecrease} ECASH\n`;
  logContent += `- Double-mint prevented: ${correctIncrease && correctVaultDecrease ? "YES" : "NO"}\n`;

  fs.appendFileSync(logPath, logContent);
  console.log("\nResults appended to DEPLOY-TEST-LOG.md");
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
