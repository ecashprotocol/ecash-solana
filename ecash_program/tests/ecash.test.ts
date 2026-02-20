const anchor = require("@coral-xyz/anchor");
const { Program, AnchorProvider, BN } = anchor;
const {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  createAssociatedTokenAccountIdempotent,
  transfer,
} = require("@solana/spl-token");
const { expect } = require("chai");
const keccak256 = require("keccak256");
const fs = require("fs");
const path = require("path");

// Load the IDL
const idlPath = path.join(__dirname, "../target/idl/ecash_program.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

// ============================================================================
// CONSTANTS (MUST MATCH LIB.RS)
// ============================================================================

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINER_STATE_SEED = Buffer.from("miner_state");
const PUZZLE_SOLVED_SEED = Buffer.from("puzzle_solved");
const VAULT_SEED = Buffer.from("vault");
const MINT_SEED = Buffer.from("ecash_mint");

// Token economics
const TOTAL_PUZZLES = 6_300;
const TOTAL_SUPPLY = 21_000_000;
const MINING_RESERVE = 18_900_000;
const LP_ALLOCATION = 2_100_000;
const TOKEN_DECIMALS = 9;

// Era definitions (2 eras)
const ERA1_END = 3_150;
const ERA2_END = 6_300;
const ERA1_REWARD = 4_000;
const ERA2_REWARD = 2_000;
const ERA1_BURN = 1_000;
const ERA2_BURN = 500;

// Batch settings
const BATCH_SIZE = 10;
const BATCH_THRESHOLD = 8;
const BATCH_COOLDOWN = 3600;

// Gas system
const INITIAL_GAS = 500;
const GAS_FLOOR = 35;
const GAS_CAP = 100;
const GAS_REGEN_RATE = 100;
const PICK_COST = 10;
const COMMIT_COST = 25;
const SOLVE_BONUS = 100;
const REFERRAL_BONUS = 100;
const MAX_ATTEMPTS = 3;
const LOCKOUT_DURATION = 86400;
const SOLVE_COOLDOWN = 300;
const PICK_TIMEOUT = 86400;
const REVEAL_WINDOW = 300;

// Production merkle root (6,300 puzzles from Base mainnet) - matches lib.rs
const PRODUCTION_MERKLE_ROOT = Buffer.from([
  0xc0, 0x6f, 0x6d, 0x42, 0xc5, 0x08, 0x31, 0xeb,
  0x4f, 0x10, 0x15, 0x6b, 0x06, 0x68, 0x70, 0x3e,
  0x70, 0x32, 0xf2, 0x03, 0x63, 0x74, 0x01, 0x07,
  0x1e, 0x9c, 0xf9, 0xca, 0xd4, 0x6a, 0xb7, 0xa9,
]);

// Test merkle root for 10 puzzles (batch 0: puzzles 0-9) - used for local testing
const MERKLE_ROOT = Buffer.from([
  0x11, 0xf1, 0xec, 0xc2, 0x52, 0x15, 0xc4, 0x42,
  0xd7, 0xbb, 0x03, 0x0b, 0xf2, 0x88, 0x1c, 0x50,
  0x30, 0x94, 0x20, 0xeb, 0x99, 0x2b, 0x55, 0xf1,
  0x96, 0xfc, 0x98, 0x45, 0xda, 0xc6, 0x9c, 0xba,
]);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface TestPuzzle {
  puzzleId: number;
  answer: string;
  salt: Buffer;
  proof: Buffer[];
}

// Normalize answer (must match Rust implementation exactly)
function normalizeAnswer(answer: string): string {
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

// Compute commit hash (keccak256(answer || salt || secret || signer))
function computeCommitHash(
  answer: string,
  salt: Buffer,
  secret: Buffer,
  signer: PublicKey
): Buffer {
  const answerBytes = Buffer.from(answer, "utf-8");
  const input = Buffer.concat([answerBytes, salt, secret, signer.toBuffer()]);
  return keccak256(input);
}

// ABI encode puzzle data (uint256, string, bytes32)
function abiEncodePuzzleData(
  puzzleId: number,
  normalizedAnswer: string,
  salt: Buffer
): Buffer {
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
  stringBytes.copy(stringData);

  return Buffer.concat([puzzleIdBytes, offsetBytes, saltSlot, lenBytes, stringData]);
}

// Compute merkle leaf (double keccak256 as per OpenZeppelin)
function computeMerkleLeaf(
  puzzleId: number,
  normalizedAnswer: string,
  salt: Buffer
): Buffer {
  const abiEncoded = abiEncodePuzzleData(puzzleId, normalizedAnswer, salt);
  const innerHash = keccak256(abiEncoded);
  return keccak256(innerHash);
}

// Sort two hashes for merkle proof verification
function sortedPairHash(a: Buffer, b: Buffer): Buffer {
  if (a.compare(b) <= 0) {
    return keccak256(Buffer.concat([a, b]));
  } else {
    return keccak256(Buffer.concat([b, a]));
  }
}

// Build a simple test merkle tree with correct proof computation
function buildTestMerkleTree(leaves: Buffer[]): { root: Buffer; proofs: Buffer[][] } {
  if (leaves.length === 0) throw new Error("Empty leaves");

  // Track position of each leaf through tree levels
  let currentLevel = [...leaves];
  const proofs: Buffer[][] = leaves.map(() => []);
  const positions = leaves.map((_, i) => i); // Each leaf's position in current level

  while (currentLevel.length > 1) {
    const nextLevel: Buffer[] = [];
    const nextPositions: number[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(sortedPairHash(left, right));
    }

    // For each original leaf, find its sibling and add to proof
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

// Create 10 test puzzles to cover full batch (need 8 solves to advance)
function createTestPuzzles(): { puzzles: TestPuzzle[]; merkleRoot: Buffer } {
  const puzzles: TestPuzzle[] = [
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

  const leaves = puzzles.map((p) =>
    computeMerkleLeaf(p.puzzleId, normalizeAnswer(p.answer), p.salt)
  );

  const { root, proofs } = buildTestMerkleTree(leaves);

  puzzles.forEach((p, i) => {
    p.proof = proofs[i];
  });

  return { puzzles, merkleRoot: root };
}

// Helper to get era info
function getRewardAmount(totalSolved: number): number {
  if (totalSolved < ERA1_END) {
    return ERA1_REWARD;
  }
  return ERA2_REWARD;
}

function getBurnAmount(totalSolved: number): number {
  if (totalSolved < ERA1_END) {
    return ERA1_BURN;
  }
  return ERA2_BURN;
}

function getCurrentEra(totalSolved: number): number {
  if (totalSolved < ERA1_END) return 1;
  return 2;
}

// ============================================================================
// TESTS
// ============================================================================

describe("Ecash Solana Program - Comprehensive Tests", () => {
  // Configure the client
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const payer = (provider.wallet as any).payer as Keypair;

  // Program ID from the IDL
  const programId = new PublicKey(idl.address);

  // PDAs
  let globalStatePda: PublicKey;
  let globalStateBump: number;
  let mintPda: PublicKey;
  let mintBump: number;
  let vaultPda: PublicKey;
  let vaultBump: number;

  // Test accounts
  let miner1: Keypair;
  let miner2: Keypair;
  let miner3: Keypair;
  let miner1StatePda: PublicKey;
  let miner2StatePda: PublicKey;
  let miner3StatePda: PublicKey;

  // Test puzzles
  let testPuzzles: TestPuzzle[];
  let testMerkleRoot: Buffer;

  before(async () => {
    // Derive PDAs
    [globalStatePda, globalStateBump] = PublicKey.findProgramAddressSync(
      [GLOBAL_STATE_SEED],
      programId
    );

    [mintPda, mintBump] = PublicKey.findProgramAddressSync(
      [MINT_SEED],
      programId
    );

    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [VAULT_SEED],
      programId
    );

    // Create test accounts
    miner1 = Keypair.generate();
    miner2 = Keypair.generate();
    miner3 = Keypair.generate();

    [miner1StatePda] = PublicKey.findProgramAddressSync(
      [MINER_STATE_SEED, miner1.publicKey.toBuffer()],
      programId
    );

    [miner2StatePda] = PublicKey.findProgramAddressSync(
      [MINER_STATE_SEED, miner2.publicKey.toBuffer()],
      programId
    );

    [miner3StatePda] = PublicKey.findProgramAddressSync(
      [MINER_STATE_SEED, miner3.publicKey.toBuffer()],
      programId
    );

    // Fund test accounts
    const airdropPromises = [miner1, miner2, miner3].map(async (miner) => {
      const sig = await connection.requestAirdrop(miner.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    });
    await Promise.all(airdropPromises);

    // Create test puzzles
    const testData = createTestPuzzles();
    testPuzzles = testData.puzzles;
    testMerkleRoot = testData.merkleRoot;

    console.log("\n=== Test Setup ===");
    console.log("Program ID:", programId.toBase58());
    console.log("Test Merkle Root:", testMerkleRoot.toString("hex"));
    console.log("Global State PDA:", globalStatePda.toBase58());
    console.log("Mint PDA:", mintPda.toBase58());
    console.log("Vault PDA:", vaultPda.toBase58());
  });

  // ========================================================================
  // 1. INITIALIZATION TESTS
  // ========================================================================

  describe("1. Initialization", () => {
    it("1.1 should initialize state (step 1)", async () => {
      const program = new Program(idl, provider);

      const tx = await program.methods
        .initializeState()
        .accounts({
          authority: payer.publicKey,
          globalState: globalStatePda,
          mint: mintPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Initialize State TX:", tx);

      const globalState = await program.account.globalState.fetch(globalStatePda);
      expect(globalState.authority.toBase58()).to.equal(payer.publicKey.toBase58());
      expect(globalState.mint.toBase58()).to.equal(mintPda.toBase58());
      expect(globalState.totalSolved.toNumber()).to.equal(0);
      expect(globalState.currentBatch.toNumber()).to.equal(0);
      expect(globalState.batchSolveCount.toNumber()).to.equal(0);
      expect(globalState.isRenounced).to.equal(false);
    });

    it("1.2 should initialize vault (step 2)", async () => {
      const program = new Program(idl, provider);

      const authorityAta = getAssociatedTokenAddressSync(
        mintPda,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const tx = await program.methods
        .initializeVault()
        .accounts({
          authority: payer.publicKey,
          globalState: globalStatePda,
          mint: mintPda,
          vault: vaultPda,
          authorityTokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Initialize Vault TX:", tx);

      const mintInfo = await getMint(connection, mintPda, undefined, TOKEN_2022_PROGRAM_ID);
      expect(mintInfo.decimals).to.equal(TOKEN_DECIMALS);

      const authorityAccount = await getAccount(connection, authorityAta, undefined, TOKEN_2022_PROGRAM_ID);
      const expectedLp = BigInt(LP_ALLOCATION) * BigInt(10 ** TOKEN_DECIMALS);
      expect(authorityAccount.amount).to.equal(expectedLp);

      const vaultAccount = await getAccount(connection, vaultPda, undefined, TOKEN_2022_PROGRAM_ID);
      const expectedReserve = BigInt(MINING_RESERVE) * BigInt(10 ** TOKEN_DECIMALS);
      expect(vaultAccount.amount).to.equal(expectedReserve);
    });

    it("1.3 should verify merkle root is set", async () => {
      const program = new Program(idl, provider);
      const globalState = await program.account.globalState.fetch(globalStatePda);
      // Verify the production merkle root is set (local tests can't verify proofs against it)
      expect(Buffer.from(globalState.merkleRoot).toString("hex")).to.equal(PRODUCTION_MERKLE_ROOT.toString("hex"));
    });

    it("1.4 should verify total supply is correct", async () => {
      const authorityAta = getAssociatedTokenAddressSync(
        mintPda,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      const authorityAccount = await getAccount(connection, authorityAta, undefined, TOKEN_2022_PROGRAM_ID);
      const vaultAccount = await getAccount(connection, vaultPda, undefined, TOKEN_2022_PROGRAM_ID);

      const totalMinted = authorityAccount.amount + vaultAccount.amount;
      const expectedTotal = BigInt(TOTAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS);
      expect(totalMinted).to.equal(expectedTotal);
    });
  });

  // ========================================================================
  // 2. REGISTRATION TESTS
  // ========================================================================

  describe("2. Registration", () => {
    it("2.1 should register miner1 without referrer", async () => {
      const program = new Program(idl, provider);

      const tx = await program.methods
        .register(PublicKey.default)
        .accounts({
          owner: miner1.publicKey,
          minerState: miner1StatePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([miner1])
        .rpc();

      console.log("Register Miner1 TX:", tx);

      const minerState = await program.account.minerState.fetch(miner1StatePda);
      expect(minerState.owner.toBase58()).to.equal(miner1.publicKey.toBase58());
      expect(minerState.registered).to.equal(true);
      expect(minerState.gasBalance.toNumber()).to.equal(INITIAL_GAS);
      expect(minerState.hasPick).to.equal(false);
      expect(minerState.hasCommit).to.equal(false);
      expect(minerState.solveCount.toNumber()).to.equal(0);
    });

    it("2.2 should register miner2 with miner1 as referrer", async () => {
      const program = new Program(idl, provider);

      const tx = await program.methods
        .register(miner1.publicKey)
        .accounts({
          owner: miner2.publicKey,
          minerState: miner2StatePda,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: miner1StatePda, isWritable: false, isSigner: false },
        ])
        .signers([miner2])
        .rpc();

      console.log("Register Miner2 TX:", tx);

      const minerState = await program.account.minerState.fetch(miner2StatePda);
      expect(minerState.owner.toBase58()).to.equal(miner2.publicKey.toBase58());
      expect(minerState.registered).to.equal(true);
      expect(minerState.gasBalance.toNumber()).to.equal(INITIAL_GAS + REFERRAL_BONUS);
      expect(minerState.referrer.toBase58()).to.equal(miner1.publicKey.toBase58());
    });

    it("2.3 should register miner3 without referrer", async () => {
      const program = new Program(idl, provider);

      const tx = await program.methods
        .register(PublicKey.default)
        .accounts({
          owner: miner3.publicKey,
          minerState: miner3StatePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([miner3])
        .rpc();

      console.log("Register Miner3 TX:", tx);

      const minerState = await program.account.minerState.fetch(miner3StatePda);
      expect(minerState.gasBalance.toNumber()).to.equal(INITIAL_GAS);
    });

    it("2.4 should reject double registration", async () => {
      const program = new Program(idl, provider);

      try {
        await program.methods
          .register(PublicKey.default)
          .accounts({
            owner: miner1.publicKey,
            minerState: miner1StatePda,
            systemProgram: SystemProgram.programId,
          })
          .signers([miner1])
          .rpc();

        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("already in use");
      }
    });

    it("2.5 should silently ignore self-referral (no bonus)", async () => {
      const newMiner = Keypair.generate();
      const sig = await connection.requestAirdrop(newMiner.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);

      const program = new Program(idl, provider);
      const [newMinerStatePda] = PublicKey.findProgramAddressSync(
        [MINER_STATE_SEED, newMiner.publicKey.toBuffer()],
        programId
      );

      // Self-referral doesn't throw error, just silently ignores the referral
      await program.methods
        .register(newMiner.publicKey)
        .accounts({
          owner: newMiner.publicKey,
          minerState: newMinerStatePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([newMiner])
        .rpc();

      // Should have INITIAL_GAS only (no referral bonus)
      const minerState = await program.account.minerState.fetch(newMinerStatePda);
      expect(minerState.gasBalance.toNumber()).to.equal(INITIAL_GAS);
    });
  });

  // ========================================================================
  // 3. ENTER BATCH TESTS
  // ========================================================================

  describe("3. Enter Batch", () => {
    it("3.1 should transfer tokens to miners for batch entry", async () => {
      const authorityAta = getAssociatedTokenAddressSync(
        mintPda,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const burnAmount = BigInt(ERA1_BURN) * BigInt(10 ** TOKEN_DECIMALS);

      for (const miner of [miner1, miner2, miner3]) {
        const minerAta = await createAssociatedTokenAccountIdempotent(
          connection,
          payer,
          mintPda,
          miner.publicKey,
          {},
          TOKEN_2022_PROGRAM_ID
        );

        await transfer(
          connection,
          payer,
          authorityAta,
          minerAta,
          payer.publicKey,
          burnAmount * 5n, // Extra for multiple entries
          [],
          undefined,
          TOKEN_2022_PROGRAM_ID
        );
      }
    });

    it("3.2 should enter batch for miner1", async () => {
      const program = new Program(idl, provider);

      const miner1Ata = getAssociatedTokenAddressSync(
        mintPda,
        miner1.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const balanceBefore = (await getAccount(connection, miner1Ata, undefined, TOKEN_2022_PROGRAM_ID)).amount;

      const tx = await program.methods
        .enterBatch()
        .accounts({
          owner: miner1.publicKey,
          minerState: miner1StatePda,
          globalState: globalStatePda,
          mint: mintPda,
          minerTokenAccount: miner1Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([miner1])
        .rpc();

      console.log("Enter Batch TX (miner1):", tx);

      const minerState = await program.account.minerState.fetch(miner1StatePda);
      expect(minerState.enteredBatch.toNumber()).to.equal(0);

      // Verify tokens were burned
      const balanceAfter = (await getAccount(connection, miner1Ata, undefined, TOKEN_2022_PROGRAM_ID)).amount;
      const burnAmount = BigInt(ERA1_BURN) * BigInt(10 ** TOKEN_DECIMALS);
      expect(balanceBefore - balanceAfter).to.equal(burnAmount);
    });

    it("3.3 should enter batch for miner2", async () => {
      const program = new Program(idl, provider);

      const miner2Ata = getAssociatedTokenAddressSync(
        mintPda,
        miner2.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const tx = await program.methods
        .enterBatch()
        .accounts({
          owner: miner2.publicKey,
          minerState: miner2StatePda,
          globalState: globalStatePda,
          mint: mintPda,
          minerTokenAccount: miner2Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([miner2])
        .rpc();

      const minerState = await program.account.minerState.fetch(miner2StatePda);
      expect(minerState.enteredBatch.toNumber()).to.equal(0);
    });

    it("3.4 should reject entering same batch twice", async () => {
      const program = new Program(idl, provider);

      const miner1Ata = getAssociatedTokenAddressSync(
        mintPda,
        miner1.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      try {
        await program.methods
          .enterBatch()
          .accounts({
            owner: miner1.publicKey,
            minerState: miner1StatePda,
            globalState: globalStatePda,
            mint: mintPda,
            minerTokenAccount: miner1Ata,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([miner1])
          .rpc();

        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("AlreadyEnteredBatch");
      }
    });

    it("3.5 should verify tokens were burned via supply reduction", async () => {
      // Check total supply decreased after burns
      const mintInfo = await getMint(connection, mintPda, undefined, TOKEN_2022_PROGRAM_ID);

      // Initial: 21M tokens, two miners burned ERA1_BURN each
      const burnedAmount = BigInt(ERA1_BURN * 2) * BigInt(10 ** TOKEN_DECIMALS);
      const expectedSupply = BigInt(TOTAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS) - burnedAmount;
      expect(mintInfo.supply).to.equal(expectedSupply);
    });
  });

  // ========================================================================
  // 4. PICK PUZZLE TESTS
  // ========================================================================

  describe("4. Pick Puzzle", () => {
    it("4.1 should pick puzzle 0 for miner1", async () => {
      const program = new Program(idl, provider);

      const gasBefore = (await program.account.minerState.fetch(miner1StatePda)).gasBalance.toNumber();

      const tx = await program.methods
        .pick(new BN(0))
        .accounts({
          owner: miner1.publicKey,
          minerState: miner1StatePda,
          globalState: globalStatePda,
        })
        .signers([miner1])
        .rpc();

      console.log("Pick Puzzle TX:", tx);

      const minerState = await program.account.minerState.fetch(miner1StatePda);
      expect(minerState.hasPick).to.equal(true);
      expect(minerState.activePick.toNumber()).to.equal(0);
      expect(minerState.gasBalance.toNumber()).to.equal(gasBefore - PICK_COST);
    });

    it("4.2 should pick puzzle 1 for miner2", async () => {
      const program = new Program(idl, provider);

      const tx = await program.methods
        .pick(new BN(1))
        .accounts({
          owner: miner2.publicKey,
          minerState: miner2StatePda,
          globalState: globalStatePda,
        })
        .signers([miner2])
        .rpc();

      const minerState = await program.account.minerState.fetch(miner2StatePda);
      expect(minerState.hasPick).to.equal(true);
      expect(minerState.activePick.toNumber()).to.equal(1);
    });

    it("4.3 should reject picking without entering batch", async () => {
      const program = new Program(idl, provider);

      try {
        await program.methods
          .pick(new BN(0))
          .accounts({
            owner: miner3.publicKey,
            minerState: miner3StatePda,
            globalState: globalStatePda,
          })
          .signers([miner3])
          .rpc();

        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("NotEnteredBatch");
      }
    });

    it("4.4 should reject picking out of batch range", async () => {
      const program = new Program(idl, provider);

      // Miner3 needs to enter batch first
      const miner3Ata = getAssociatedTokenAddressSync(
        mintPda,
        miner3.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      await program.methods
        .enterBatch()
        .accounts({
          owner: miner3.publicKey,
          minerState: miner3StatePda,
          globalState: globalStatePda,
          mint: mintPda,
          minerTokenAccount: miner3Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([miner3])
        .rpc();

      try {
        await program.methods
          .pick(new BN(100)) // Out of batch 0 range (0-9)
          .accounts({
            owner: miner3.publicKey,
            minerState: miner3StatePda,
            globalState: globalStatePda,
          })
          .signers([miner3])
          .rpc();

        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("PuzzleOutOfBatchRange");
      }
    });

    it("4.5 should reject picking when already has pick", async () => {
      const program = new Program(idl, provider);

      try {
        await program.methods
          .pick(new BN(1))
          .accounts({
            owner: miner1.publicKey,
            minerState: miner1StatePda,
            globalState: globalStatePda,
          })
          .signers([miner1])
          .rpc();

        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("AlreadyHasPick");
      }
    });
  });

  // ========================================================================
  // 5. COMMIT TESTS
  // ========================================================================

  describe("5. Commit", () => {
    let commitHash: Buffer;
    const testSalt = Buffer.alloc(32, 0xaa);
    const testSecret = Buffer.alloc(32, 0xbb);

    it("5.1 should commit a solution", async () => {
      const program = new Program(idl, provider);
      const puzzle = testPuzzles[0];

      commitHash = computeCommitHash(
        puzzle.answer,
        testSalt,
        testSecret,
        miner1.publicKey
      );

      const gasBefore = (await program.account.minerState.fetch(miner1StatePda)).gasBalance.toNumber();

      const tx = await program.methods
        .commitSolve([...commitHash])
        .accounts({
          owner: miner1.publicKey,
          minerState: miner1StatePda,
        })
        .signers([miner1])
        .rpc();

      console.log("Commit TX:", tx);

      const minerState = await program.account.minerState.fetch(miner1StatePda);
      expect(minerState.hasCommit).to.equal(true);
      expect(Buffer.from(minerState.commitHash).toString("hex")).to.equal(commitHash.toString("hex"));
      expect(minerState.attempts).to.equal(1);
      expect(minerState.gasBalance.toNumber()).to.equal(gasBefore - COMMIT_COST);
    });

    it("5.2 should reject committing when already has commit", async () => {
      const program = new Program(idl, provider);

      const newHash = computeCommitHash("another answer", testSalt, testSecret, miner1.publicKey);

      try {
        await program.methods
          .commitSolve([...newHash])
          .accounts({
            owner: miner1.publicKey,
            minerState: miner1StatePda,
          })
          .signers([miner1])
          .rpc();

        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("AlreadyHasCommit");
      }
    });

    it("5.3 should reject committing without pick", async () => {
      const program = new Program(idl, provider);

      const newMiner = Keypair.generate();
      const sig = await connection.requestAirdrop(newMiner.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);

      const [newMinerStatePda] = PublicKey.findProgramAddressSync(
        [MINER_STATE_SEED, newMiner.publicKey.toBuffer()],
        programId
      );

      // Register
      await program.methods
        .register(PublicKey.default)
        .accounts({
          owner: newMiner.publicKey,
          minerState: newMinerStatePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([newMiner])
        .rpc();

      try {
        await program.methods
          .commitSolve([...commitHash])
          .accounts({
            owner: newMiner.publicKey,
            minerState: newMinerStatePda,
          })
          .signers([newMiner])
          .rpc();

        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("NoPick");
      }
    });
  });

  // ========================================================================
  // 6. REVEAL TESTS
  // ========================================================================

  describe("6. Reveal", () => {
    const testSalt = Buffer.alloc(32, 0xaa);
    const testSecret = Buffer.alloc(32, 0xbb);

    it("6.1 should reject reveal with wrong answer (invalid commit hash)", async () => {
      const program = new Program(idl, provider);
      const puzzle = testPuzzles[0];

      // Wait for slot to advance
      await new Promise(resolve => setTimeout(resolve, 500));

      const [puzzleSolvedPda] = PublicKey.findProgramAddressSync(
        [PUZZLE_SOLVED_SEED, new BN(0).toArrayLike(Buffer, "le", 8)],
        programId
      );

      const minerAta = getAssociatedTokenAddressSync(
        mintPda,
        miner1.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      try {
        await program.methods
          .revealSolve(
            "wrong answer",
            [...testSalt],
            [...testSecret],
            puzzle.proof.map((p) => [...p])
          )
          .accounts({
            owner: miner1.publicKey,
            minerState: miner1StatePda,
            globalState: globalStatePda,
            puzzleSolved: puzzleSolvedPda,
            mint: mintPda,
            vault: vaultPda,
            minerTokenAccount: minerAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([miner1])
          .rpc();

        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("InvalidCommitHash");
      }
    });

    it("6.2 should reject reveal with wrong salt", async () => {
      const program = new Program(idl, provider);
      const puzzle = testPuzzles[0];

      const [puzzleSolvedPda] = PublicKey.findProgramAddressSync(
        [PUZZLE_SOLVED_SEED, new BN(0).toArrayLike(Buffer, "le", 8)],
        programId
      );

      const minerAta = getAssociatedTokenAddressSync(
        mintPda,
        miner1.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const wrongSalt = Buffer.alloc(32, 0xff);

      try {
        await program.methods
          .revealSolve(
            puzzle.answer,
            [...wrongSalt],
            [...testSecret],
            puzzle.proof.map((p) => [...p])
          )
          .accounts({
            owner: miner1.publicKey,
            minerState: miner1StatePda,
            globalState: globalStatePda,
            puzzleSolved: puzzleSolvedPda,
            mint: mintPda,
            vault: vaultPda,
            minerTokenAccount: minerAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([miner1])
          .rpc();

        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("InvalidCommitHash");
      }
    });

    it("6.3 should reject reveal without commit", async () => {
      const program = new Program(idl, provider);
      const puzzle = testPuzzles[1];

      // Miner2 has pick but no commit yet
      const minerState = await program.account.minerState.fetch(miner2StatePda);
      expect(minerState.hasCommit).to.equal(false);

      const [puzzleSolvedPda] = PublicKey.findProgramAddressSync(
        [PUZZLE_SOLVED_SEED, new BN(1).toArrayLike(Buffer, "le", 8)],
        programId
      );

      const minerAta = getAssociatedTokenAddressSync(
        mintPda,
        miner2.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      try {
        await program.methods
          .revealSolve(
            puzzle.answer,
            [...puzzle.salt],
            [...testSecret],
            puzzle.proof.map((p) => [...p])
          )
          .accounts({
            owner: miner2.publicKey,
            minerState: miner2StatePda,
            globalState: globalStatePda,
            puzzleSolved: puzzleSolvedPda,
            mint: mintPda,
            vault: vaultPda,
            minerTokenAccount: minerAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([miner2])
          .rpc();

        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("NoCommit");
      }
    });
  });

  // ========================================================================
  // 7. GAS SYSTEM TESTS
  // ========================================================================

  describe("7. Gas System", () => {
    it("7.1 should verify gas costs are applied correctly", async () => {
      const program = new Program(idl, provider);
      const minerState = await program.account.minerState.fetch(miner1StatePda);

      // After pick and commit: INITIAL_GAS - PICK_COST - COMMIT_COST
      const expectedGas = INITIAL_GAS - PICK_COST - COMMIT_COST;
      expect(minerState.gasBalance.toNumber()).to.equal(expectedGas);
    });

    it("7.2 should verify referral bonus is applied", async () => {
      const program = new Program(idl, provider);
      const minerState = await program.account.minerState.fetch(miner2StatePda);

      // Miner2 had referral bonus but used PICK_COST
      const expectedGas = INITIAL_GAS + REFERRAL_BONUS - PICK_COST;
      expect(minerState.gasBalance.toNumber()).to.equal(expectedGas);
    });

    it("7.3 should claim daily gas (no increase if <24h)", async () => {
      const program = new Program(idl, provider);

      const minerStateBefore = await program.account.minerState.fetch(miner3StatePda);
      const gasBefore = minerStateBefore.gasBalance.toNumber();

      await program.methods
        .claimDailyGas()
        .accounts({
          owner: miner3.publicKey,
          minerState: miner3StatePda,
          globalState: globalStatePda,
        })
        .signers([miner3])
        .rpc();

      const minerStateAfter = await program.account.minerState.fetch(miner3StatePda);
      const gasAfter = minerStateAfter.gasBalance.toNumber();

      // Gas should not decrease (may increase if 24h passed)
      expect(gasAfter).to.be.at.least(gasBefore);
    });
  });

  // ========================================================================
  // 8. CANCEL EXPIRED COMMIT TESTS
  // ========================================================================

  describe("8. Cancel Expired Commit", () => {
    it("8.1 should reject canceling non-expired commit", async () => {
      const program = new Program(idl, provider);

      const minerState = await program.account.minerState.fetch(miner1StatePda);

      if (minerState.hasCommit) {
        try {
          await program.methods
            .cancelExpiredCommit()
            .accounts({
              owner: miner1.publicKey,
              minerState: miner1StatePda,
            })
            .signers([miner1])
            .rpc();

          expect.fail("Should have thrown error");
        } catch (err: any) {
          expect(err.message).to.include("CommitNotExpired");
        }
      }
    });
  });

  // ========================================================================
  // 9. ADMIN FUNCTION TESTS
  // ========================================================================

  describe("9. Admin Functions", () => {
    it("9.1 should reject non-authority renouncing ownership", async () => {
      const program = new Program(idl, provider);

      try {
        await program.methods
          .renounceOwnership()
          .accounts({
            authority: miner1.publicKey,
            globalState: globalStatePda,
          })
          .signers([miner1])
          .rpc();

        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("Unauthorized");
      }
    });

    it("9.2 should verify authority is set correctly", async () => {
      const program = new Program(idl, provider);
      const globalState = await program.account.globalState.fetch(globalStatePda);
      expect(globalState.authority.toBase58()).to.equal(payer.publicKey.toBase58());
    });

    it("9.3 should verify isRenounced is false initially", async () => {
      const program = new Program(idl, provider);
      const globalState = await program.account.globalState.fetch(globalStatePda);
      expect(globalState.isRenounced).to.equal(false);
    });
  });

  // ========================================================================
  // 10. ANSWER NORMALIZATION TESTS
  // ========================================================================

  describe("10. Answer Normalization", () => {
    it("10.1 should lowercase correctly", () => {
      expect(normalizeAnswer("The Rosetta Stone")).to.equal("the rosetta stone");
      expect(normalizeAnswer("HELLO WORLD")).to.equal("hello world");
    });

    it("10.2 should remove special characters", () => {
      expect(normalizeAnswer("test-123!")).to.equal("test123");
      expect(normalizeAnswer("café")).to.equal("caf");
      expect(normalizeAnswer("hello@world.com")).to.equal("helloworldcom");
    });

    it("10.3 should trim whitespace", () => {
      expect(normalizeAnswer("  hello  ")).to.equal("hello");
      expect(normalizeAnswer("   ")).to.equal("");
    });

    it("10.4 should collapse multiple spaces", () => {
      expect(normalizeAnswer("  a  b  c  ")).to.equal("a b c");
      expect(normalizeAnswer("hello     world")).to.equal("hello world");
    });

    it("10.5 should handle numbers", () => {
      expect(normalizeAnswer("123")).to.equal("123");
      expect(normalizeAnswer("test 123 answer")).to.equal("test 123 answer");
    });

    it("10.6 should handle empty strings", () => {
      expect(normalizeAnswer("")).to.equal("");
      expect(normalizeAnswer("   ")).to.equal("");
      expect(normalizeAnswer("!!!")).to.equal("");
    });
  });

  // ========================================================================
  // 11. MERKLE PROOF TESTS
  // ========================================================================

  describe("11. Merkle Proof", () => {
    it("11.1 should compute correct merkle leaves", () => {
      const puzzle = testPuzzles[0];
      const normalized = normalizeAnswer(puzzle.answer);
      const leaf = computeMerkleLeaf(puzzle.puzzleId, normalized, puzzle.salt);

      expect(leaf.length).to.equal(32);
    });

    it("11.2 should compute correct ABI encoding", () => {
      const encoded = abiEncodePuzzleData(0, "the rosetta stone", Buffer.alloc(32, 1));

      // Should have: 32 (puzzleId) + 32 (offset) + 32 (salt) + 32 (len) + 32 (data) = 160 bytes min
      expect(encoded.length).to.be.at.least(160);

      // First 32 bytes should be puzzle ID (0)
      expect(encoded.slice(0, 31).every((b: number) => b === 0)).to.be.true;
      expect(encoded[31]).to.equal(0);

      // Offset should be 96 (0x60)
      expect(encoded[63]).to.equal(0x60);
    });

    it("11.3 should verify test merkle tree integrity", () => {
      // Verify all puzzles have proofs
      for (const puzzle of testPuzzles) {
        expect(puzzle.proof).to.not.be.undefined;
      }
    });
  });

  // ========================================================================
  // 12. ERA CALCULATION TESTS
  // ========================================================================

  describe("12. Era Calculations", () => {
    it("12.1 should return correct era for puzzle counts", () => {
      expect(getCurrentEra(0)).to.equal(1);
      expect(getCurrentEra(100)).to.equal(1);
      expect(getCurrentEra(3149)).to.equal(1);
      expect(getCurrentEra(3150)).to.equal(2);
      expect(getCurrentEra(6000)).to.equal(2);
    });

    it("12.2 should return correct reward amounts", () => {
      expect(getRewardAmount(0)).to.equal(ERA1_REWARD);
      expect(getRewardAmount(3149)).to.equal(ERA1_REWARD);
      expect(getRewardAmount(3150)).to.equal(ERA2_REWARD);
      expect(getRewardAmount(6299)).to.equal(ERA2_REWARD);
    });

    it("12.3 should return correct burn amounts", () => {
      expect(getBurnAmount(0)).to.equal(ERA1_BURN);
      expect(getBurnAmount(3149)).to.equal(ERA1_BURN);
      expect(getBurnAmount(3150)).to.equal(ERA2_BURN);
      expect(getBurnAmount(6299)).to.equal(ERA2_BURN);
    });
  });

  // ========================================================================
  // 13. CONSTANTS VERIFICATION TESTS
  // ========================================================================

  describe("13. Constants Verification", () => {
    it("13.1 should verify total supply splits correctly", () => {
      expect(LP_ALLOCATION + MINING_RESERVE).to.equal(TOTAL_SUPPLY);
    });

    it("13.2 should verify era boundaries", () => {
      expect(ERA1_END).to.equal(3150);
      expect(ERA2_END).to.equal(6300);
      expect(ERA2_END).to.equal(TOTAL_PUZZLES);
    });

    it("13.3 should verify gas constants", () => {
      expect(INITIAL_GAS).to.equal(500);
      expect(GAS_FLOOR).to.equal(35);
      expect(GAS_CAP).to.equal(100);
      expect(GAS_REGEN_RATE).to.equal(100);
      expect(PICK_COST).to.equal(10);
      expect(COMMIT_COST).to.equal(25);
    });

    it("13.4 should verify batch settings", () => {
      expect(BATCH_SIZE).to.equal(10);
      expect(BATCH_THRESHOLD).to.equal(8);
      expect(BATCH_COOLDOWN).to.equal(3600);
    });
  });

  // ========================================================================
  // 14. PDA DERIVATION TESTS
  // ========================================================================

  describe("14. PDA Derivation", () => {
    it("14.1 should derive global state PDA correctly", () => {
      const [pda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], programId);
      expect(pda.toBase58()).to.equal(globalStatePda.toBase58());
    });

    it("14.2 should derive mint PDA correctly", () => {
      const [pda] = PublicKey.findProgramAddressSync([MINT_SEED], programId);
      expect(pda.toBase58()).to.equal(mintPda.toBase58());
    });

    it("14.3 should derive vault PDA correctly", () => {
      const [pda] = PublicKey.findProgramAddressSync([VAULT_SEED], programId);
      expect(pda.toBase58()).to.equal(vaultPda.toBase58());
    });

    it("14.4 should derive miner state PDAs correctly", () => {
      const [pda1] = PublicKey.findProgramAddressSync(
        [MINER_STATE_SEED, miner1.publicKey.toBuffer()],
        programId
      );
      expect(pda1.toBase58()).to.equal(miner1StatePda.toBase58());
    });

    it("14.5 should derive puzzle solved PDAs correctly", () => {
      const puzzleId = 0;
      const [pda] = PublicKey.findProgramAddressSync(
        [PUZZLE_SOLVED_SEED, new BN(puzzleId).toArrayLike(Buffer, "le", 8)],
        programId
      );
      expect(pda).to.be.instanceOf(PublicKey);
    });
  });

  // ========================================================================
  // 15. COMMIT HASH COMPUTATION TESTS
  // ========================================================================

  describe("15. Commit Hash Computation", () => {
    it("15.1 should compute deterministic commit hash", () => {
      const answer = "test answer";
      const salt = Buffer.alloc(32, 1);
      const secret = Buffer.alloc(32, 2);
      const signer = Keypair.generate().publicKey;

      const hash1 = computeCommitHash(answer, salt, secret, signer);
      const hash2 = computeCommitHash(answer, salt, secret, signer);

      expect(hash1.toString("hex")).to.equal(hash2.toString("hex"));
    });

    it("15.2 should produce different hashes for different answers", () => {
      const salt = Buffer.alloc(32, 1);
      const secret = Buffer.alloc(32, 2);
      const signer = Keypair.generate().publicKey;

      const hash1 = computeCommitHash("answer1", salt, secret, signer);
      const hash2 = computeCommitHash("answer2", salt, secret, signer);

      expect(hash1.toString("hex")).to.not.equal(hash2.toString("hex"));
    });

    it("15.3 should produce different hashes for different signers", () => {
      const answer = "test answer";
      const salt = Buffer.alloc(32, 1);
      const secret = Buffer.alloc(32, 2);
      const signer1 = Keypair.generate().publicKey;
      const signer2 = Keypair.generate().publicKey;

      const hash1 = computeCommitHash(answer, salt, secret, signer1);
      const hash2 = computeCommitHash(answer, salt, secret, signer2);

      expect(hash1.toString("hex")).to.not.equal(hash2.toString("hex"));
    });
  });

  // ========================================================================
  // SUMMARY
  // ========================================================================

  describe("Summary", () => {
    it("prints test summary", () => {
      console.log("\n=== Ecash Solana Program Test Summary ===");
      console.log("Total test categories: 15");
      console.log("Tests cover:");
      console.log("  1. Initialization (state + vault)");
      console.log("  2. Miner registration with/without referral");
      console.log("  3. Enter batch with token burning");
      console.log("  4. Puzzle picking");
      console.log("  5. Commit pattern");
      console.log("  6. Reveal pattern");
      console.log("  7. Gas system");
      console.log("  8. Cancel expired commit");
      console.log("  9. Admin functions");
      console.log(" 10. Answer normalization");
      console.log(" 11. Merkle proof computation");
      console.log(" 12. Era calculations");
      console.log(" 13. Constants verification");
      console.log(" 14. PDA derivation");
      console.log(" 15. Commit hash computation");
    });
  });
});
