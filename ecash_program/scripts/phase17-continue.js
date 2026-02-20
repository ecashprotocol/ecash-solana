// Continue Phase 17 - Enter batch 1 and solve 2 more puzzles
const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } = require("@solana/spl-token");
const { keccak_256 } = require("js-sha3");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROGRAM_ID = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
const MINT = new PublicKey("7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7");
const VAULT = new PublicKey("HP5d2aqS3wzc13SwbzojDrhZDjFDYC6RNvH5R8q8Bb6d");
const GLOBAL_STATE = new PublicKey("ELXyB21ZTJiQUHf3pu4W95AiYJ14EDByCqX2JzPZtZqS");
const MINER_STATE_SEED = Buffer.from("miner_state");
const PUZZLE_SOLVED_SEED = Buffer.from("puzzle_solved");

const keccak = (data) => Buffer.from(keccak_256.arrayBuffer(data));

const loadWallet = (n) => Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), `ecash-solana/${n}.json`))))
);

function hexToBuffer(hex) {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  return Buffer.from(hex, "hex");
}

const loadPuzzleData = () => {
  const proofsPath = path.join(os.homedir(), "ecash-protocol-v3/merkle/merkle-proofs.json");
  return JSON.parse(fs.readFileSync(proofsPath, "utf-8"));
};

async function main() {
  console.log("Continuing Phase 17 - Entering batch 1 and solving 2 more puzzles...");

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const w1 = loadWallet("wallet-1");

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  idl.address = PROGRAM_ID.toString();

  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(w1), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const prog = new anchor.Program(idl, provider);

  const puzzleData = loadPuzzleData();
  const minerPda = PublicKey.findProgramAddressSync([MINER_STATE_SEED, w1.publicKey.toBuffer()], PROGRAM_ID)[0];
  const ata = getAssociatedTokenAddressSync(MINT, w1.publicKey, false, TOKEN_2022_PROGRAM_ID);

  // Enter batch 1
  console.log("\n--- Entering Batch 1 ---");
  let minerState = await prog.account.minerState.fetch(minerPda);
  console.log("Current entered batch:", minerState.enteredBatch.toString());

  if (minerState.enteredBatch.toNumber() === 0) {
    try {
      const tx = await prog.methods
        .enterBatch()
        .accounts({
          owner: w1.publicKey,
          minerState: minerPda,
          globalState: GLOBAL_STATE,
          mint: MINT,
          minerTokenAccount: ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      await conn.confirmTransaction(tx, "confirmed");
      console.log("[OK] Entered batch 1:", tx.slice(0, 16) + "...");
    } catch (e) {
      console.log("[ERROR] enterBatch failed:", e.message.slice(0, 80));
      return;
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  // Solve puzzles 10 and 11
  const puzzlesToSolve = [10, 11];

  for (const puzzleId of puzzlesToSolve) {
    const puz = puzzleData[String(puzzleId)];
    const puzzleSolvedPda = PublicKey.findProgramAddressSync([PUZZLE_SOLVED_SEED, new BN(puzzleId).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];

    console.log(`\n--- Solving puzzle ${puzzleId} ---`);
    console.log(`  Answer: "${puz.answer}"`);

    // Check if already solved
    try {
      await prog.account.puzzleSolved.fetch(puzzleSolvedPda);
      console.log("  Already solved, skipping");
      continue;
    } catch {}

    minerState = await prog.account.minerState.fetch(minerPda);

    // Pick
    if (!minerState.hasPick || minerState.activePick.toNumber() !== puzzleId) {
      try {
        const pickTx = await prog.methods
          .pick(new BN(puzzleId))
          .accounts({
            owner: w1.publicKey,
            minerState: minerPda,
            globalState: GLOBAL_STATE,
          })
          .rpc();
        await conn.confirmTransaction(pickTx, "confirmed");
        console.log("  Picked:", pickTx.slice(0, 16) + "...");
      } catch (e) {
        console.log("  [ERROR] Pick failed:", e.message.slice(0, 60));
        return;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // Commit
    const salt = hexToBuffer(puz.salt);
    const secret = keccak(Buffer.concat([Buffer.from("secret"), w1.publicKey.toBuffer(), new BN(puzzleId).toArrayLike(Buffer, "le", 8)]));
    const commitHash = keccak(Buffer.concat([Buffer.from(puz.answer), salt, secret, w1.publicKey.toBuffer()]));

    minerState = await prog.account.minerState.fetch(minerPda);
    if (!minerState.hasCommit) {
      try {
        const commitTx = await prog.methods
          .commitSolve(Array.from(commitHash))
          .accounts({
            owner: w1.publicKey,
            minerState: minerPda,
          })
          .rpc();
        await conn.confirmTransaction(commitTx, "confirmed");
        console.log("  Committed:", commitTx.slice(0, 16) + "...");
      } catch (e) {
        console.log("  [ERROR] Commit failed:", e.message.slice(0, 60));
        return;
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    // Reveal
    const proof = puz.proof.map(p => Array.from(hexToBuffer(p)));

    try {
      const balBefore = Number((await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);

      const revealTx = await prog.methods
        .revealSolve(puz.answer, Array.from(salt), Array.from(secret), proof)
        .accounts({
          owner: w1.publicKey,
          minerState: minerPda,
          globalState: GLOBAL_STATE,
          puzzleSolved: puzzleSolvedPda,
          mint: MINT,
          vault: VAULT,
          minerTokenAccount: ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await conn.confirmTransaction(revealTx, "confirmed");
      const balAfter = Number((await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
      console.log("  [SOLVED] Reward:", (balAfter - balBefore) / 1e9, "ECASH");
      console.log("  TX:", revealTx);
    } catch (e) {
      console.log("  [ERROR] Reveal failed:", e.message);
      return;
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Final state
  console.log("\n=== Final State ===");
  minerState = await prog.account.minerState.fetch(minerPda);
  console.log("W1 Solve Count:", minerState.solveCount.toString());
  console.log("W1 Gas Balance:", minerState.gasBalance.toString());

  const solves = minerState.solveCount.toNumber();
  const tier = solves >= 50 ? "Diamond" : solves >= 25 ? "Gold" : solves >= 10 ? "SILVER" : "Bronze";
  console.log("W1 Tier:", tier);

  const gs = await prog.account.globalState.fetch(GLOBAL_STATE);
  console.log("\nGlobal Total Solved:", gs.totalSolved.toString());
  console.log("Global Total Burned:", Number(gs.totalBurned) / 1e9, "ECASH");
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
