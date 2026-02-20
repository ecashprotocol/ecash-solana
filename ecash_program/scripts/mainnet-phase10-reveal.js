// Phase 10 - Part 2: Reveal the committed solutions
// This continues from where the commits were made

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

async function loadWallet(name) {
  const walletPath = path.join(os.homedir(), `ecash-solana/${name}.json`);
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
}

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 10 - INVESTIGATING REVEAL FAILURE");
  console.log("=".repeat(60));

  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const deployer = await loadWallet("deployer");
  const wallet4 = await loadWallet("wallet-4");

  const idlPath = path.join(__dirname, "../target/idl/ecash_program.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  const provider = new AnchorProvider(connection, new anchor.Wallet(deployer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl, provider);

  const [globalStatePda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_ID);

  const getMinerPda = (pubkey) => PublicKey.findProgramAddressSync([MINER_STATE_SEED, pubkey.toBuffer()], PROGRAM_ID)[0];
  const getPuzzleSolvedPda = (puzzleId) => PublicKey.findProgramAddressSync(
    [PUZZLE_SOLVED_SEED, new BN(puzzleId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];

  const { puzzles } = createTestPuzzles();
  const puzzle = puzzles[3]; // puzzle 3

  // Get miner state
  const minerStatePda = getMinerPda(wallet4.publicKey);
  const minerState = await program.account.minerState.fetch(minerStatePda);

  console.log("\nW4 Miner State:");
  console.log("  hasPick:", minerState.hasPick);
  console.log("  activePick:", minerState.activePick.toNumber());
  console.log("  hasCommit:", minerState.hasCommit);
  console.log("  commitHash:", Buffer.from(minerState.commitHash).toString("hex").slice(0, 32) + "...");
  console.log("  commitSlot:", minerState.commitSlot.toNumber());

  const currentSlot = await connection.getSlot();
  console.log("\nCurrent slot:", currentSlot);
  console.log("Slots since commit:", currentSlot - minerState.commitSlot.toNumber());
  console.log("Within 300 slot window:", currentSlot - minerState.commitSlot.toNumber() <= 300);

  // The problem is: we committed with a random secret that was lost
  // We cannot reveal without knowing the exact secret used in the commit

  console.log("\n*** DIAGNOSIS ***");
  console.log("The commit was made with a random secret (crypto.randomBytes(32))");
  console.log("That secret was NOT saved, so we CANNOT reveal the solution");
  console.log("This is expected behavior - commit-reveal requires the same secret");

  console.log("\n*** SOLUTION ***");
  console.log("1. Cancel the expired commits (wait for them to expire)");
  console.log("2. Clear the picks");
  console.log("3. Re-run with secrets saved to file");

  // Check how long until commit expires
  const slotsRemaining = (minerState.commitSlot.toNumber() + 300) - currentSlot;
  if (slotsRemaining > 0) {
    console.log(`\nCommit expires in ${slotsRemaining} slots (~${Math.ceil(slotsRemaining * 0.4)} seconds)`);
    console.log("Waiting for commit to expire...");
    await new Promise(r => setTimeout(r, Math.ceil(slotsRemaining * 400) + 5000));
  }

  // Now cancel expired commit and clear pick
  console.log("\nCancelling expired commits and clearing picks...");

  for (const [name, wallet] of [["W4", wallet4]]) {
    try {
      const mPda = getMinerPda(wallet.publicKey);

      // Cancel expired commit
      try {
        const tx = await program.methods
          .cancelExpiredCommit()
          .accounts({
            owner: wallet.publicKey,
            minerState: mPda,
          })
          .signers([wallet])
          .rpc();
        await connection.confirmTransaction(tx, "confirmed");
        console.log(`${name} commit cancelled: ${tx}`);
      } catch (e) {
        console.log(`${name} cancel commit: ${e.message.slice(0, 50)}`);
      }

      // Clear pick (puzzle 3 is NOT solved, so we need to abandon pick differently)
      // Actually, we can just pick a different puzzle
    } catch (e) {
      console.log(`${name} error: ${e.message.slice(0, 50)}`);
    }
  }

  console.log("\nDone. To properly test competitive mining:");
  console.log("1. Make sure commits use a saved/deterministic secret");
  console.log("2. Reveal immediately after commit within 300 slot window");
}

main().catch(console.error);
