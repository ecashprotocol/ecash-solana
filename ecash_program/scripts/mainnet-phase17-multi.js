// Phase 17: Silver Tier - Multi-wallet solver
// Uses W2, W3, and continues until Silver tier

const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } = require("@solana/spl-token");
const { keccak256 } = require("js-sha3");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROGRAM_ID = new PublicKey("7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u");
const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");
const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINER_STATE_SEED = Buffer.from("miner_state");
const PUZZLE_SOLVED_SEED = Buffer.from("puzzle_solved");
const VAULT_SEED = Buffer.from("vault");

const keccak = (input) => Buffer.from(keccak256.arrayBuffer(input));
const normalizeAnswer = (a) => a.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, " ");

function abiEncode(puzzleId, answer, salt) {
  const id = Buffer.alloc(32); new BN(puzzleId).toArrayLike(Buffer, "be", 8).copy(id, 24);
  const off = Buffer.alloc(32); off[31] = 0x60;
  const str = Buffer.from(answer);
  const len = Buffer.alloc(32); new BN(str.length).toArrayLike(Buffer, "be", 8).copy(len, 24);
  const pad = Buffer.alloc(Math.max(Math.ceil(str.length / 32) * 32, 32)); str.copy(pad);
  return Buffer.concat([id, off, salt, len, pad]);
}

const merkleLeaf = (id, ans, salt) => keccak(keccak(abiEncode(id, ans, salt)));
const sortHash = (a, b) => a.compare(b) <= 0 ? keccak(Buffer.concat([a, b])) : keccak(Buffer.concat([b, a]));

function buildTree(leaves) {
  let lvl = [...leaves];
  const proofs = leaves.map(() => []);
  const pos = leaves.map((_, i) => i);
  while (lvl.length > 1) {
    const next = [];
    for (let i = 0; i < lvl.length; i += 2) next.push(sortHash(lvl[i], lvl[i + 1] || lvl[i]));
    for (let j = 0; j < leaves.length; j++) {
      const sib = pos[j] % 2 === 0 ? pos[j] + 1 : pos[j] - 1;
      if (sib < lvl.length) proofs[j].push(lvl[sib]);
      pos[j] = Math.floor(pos[j] / 2);
    }
    lvl = next;
  }
  return proofs;
}

const puzzles = [
  { id: 0, ans: "the rosetta stone", salt: Buffer.alloc(32, 1) },
  { id: 1, ans: "fibonacci sequence", salt: Buffer.alloc(32, 2) },
  { id: 2, ans: "golden ratio", salt: Buffer.alloc(32, 3) },
  { id: 3, ans: "prime number", salt: Buffer.alloc(32, 4) },
  { id: 4, ans: "euler identity", salt: Buffer.alloc(32, 5) },
  { id: 5, ans: "pythagorean theorem", salt: Buffer.alloc(32, 6) },
  { id: 6, ans: "archimedes principle", salt: Buffer.alloc(32, 7) },
  { id: 7, ans: "newtons laws", salt: Buffer.alloc(32, 8) },
  { id: 8, ans: "theory of relativity", salt: Buffer.alloc(32, 9) },
  { id: 9, ans: "quantum mechanics", salt: Buffer.alloc(32, 10) },
];
const leaves = puzzles.map(p => merkleLeaf(p.id, normalizeAnswer(p.ans), p.salt));
const proofs = buildTree(leaves);
puzzles.forEach((p, i) => { p.proof = proofs[i]; p.answer = normalizeAnswer(p.ans); });

const loadWallet = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), `ecash-solana/${n}.json`)))));

const results = [];
let pass = 0, fail = 0;
const log = (id, name, exp, act, tx, ok) => {
  if (ok) pass++; else fail++;
  results.push({ id, name, exp, act, tx, status: ok ? "PASS" : "FAIL" });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id}: ${name}`);
  if (tx) console.log(`       TX: ${tx}`);
  if (!ok) console.log(`       Expected: ${exp}, Got: ${act}`);
};

async function solvePuzzle(conn, prog, wallet, walletName, puzzleId, gsPda, vaultPda) {
  const puz = puzzles[puzzleId];
  if (!puz) return { success: false, error: `No puzzle ${puzzleId}` };

  const minerPda = PublicKey.findProgramAddressSync([MINER_STATE_SEED, wallet.publicKey.toBuffer()], PROGRAM_ID)[0];
  const puzzleSolvedPda = PublicKey.findProgramAddressSync([PUZZLE_SOLVED_SEED, new BN(puzzleId).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];
  const ata = getAssociatedTokenAddressSync(MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);

  try {
    await prog.account.puzzleSolved.fetch(puzzleSolvedPda);
    return { success: false, error: `Puzzle ${puzzleId} already solved` };
  } catch {}

  const minerState = await prog.account.minerState.fetch(minerPda);
  const slot = await conn.getSlot();
  const now = Math.floor(Date.now() / 1000);

  if (minerState.lockoutEnd.toNumber() > now) {
    return { success: false, error: `${walletName} is locked out until ${new Date(minerState.lockoutEnd.toNumber() * 1000).toISOString()}` };
  }

  if (minerState.hasPick && minerState.activePick.toNumber() !== puzzleId) {
    return { success: false, error: `${walletName} has pick for different puzzle ${minerState.activePick.toNumber()}` };
  }

  if (minerState.hasCommit && slot > minerState.commitSlot.toNumber() + 300) {
    try {
      console.log(`  [${walletName}] Canceling expired commit...`);
      const cancelTx = await prog.methods.cancelExpiredCommit()
        .accounts({ owner: wallet.publicKey, minerState: minerPda })
        .signers([wallet])
        .rpc();
      await conn.confirmTransaction(cancelTx, "confirmed");
    } catch {}
  }

  const secret = keccak(Buffer.concat([Buffer.from(`solve-${puzzleId}`), wallet.publicKey.toBuffer()]));
  const txHashes = [];
  const alreadyHasPick = minerState.hasPick && minerState.activePick.toNumber() === puzzleId;

  try {
    if (!alreadyHasPick) {
      console.log(`  [${walletName}][${puzzleId}] Picking...`);
      const pickTx = await prog.methods.pick(new BN(puzzleId))
        .accounts({ owner: wallet.publicKey, minerState: minerPda, globalState: gsPda })
        .signers([wallet])
        .rpc();
      await conn.confirmTransaction(pickTx, "confirmed");
      txHashes.push({ step: "pick", tx: pickTx });
      console.log(`  [${walletName}][${puzzleId}] Pick: ${pickTx.slice(0, 16)}...`);
    }

    const commitHash = keccak(Buffer.concat([Buffer.from(puz.answer), puz.salt, secret, wallet.publicKey.toBuffer()]));
    console.log(`  [${walletName}][${puzzleId}] Committing...`);
    const commitTx = await prog.methods.commitSolve([...commitHash])
      .accounts({ owner: wallet.publicKey, minerState: minerPda })
      .signers([wallet])
      .rpc();
    await conn.confirmTransaction(commitTx, "confirmed");
    txHashes.push({ step: "commit", tx: commitTx });
    console.log(`  [${walletName}][${puzzleId}] Commit: ${commitTx.slice(0, 16)}...`);

    await new Promise(r => setTimeout(r, 600));

    console.log(`  [${walletName}][${puzzleId}] Revealing...`);
    const balBefore = Number((await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    const revealTx = await prog.methods.revealSolve(
      puz.answer, Array.from(puz.salt), Array.from(secret), puz.proof.map(p => Array.from(p))
    )
      .accounts({
        owner: wallet.publicKey, minerState: minerPda, globalState: gsPda, puzzleSolved: puzzleSolvedPda,
        mint: MINT, vault: vaultPda, minerTokenAccount: ata, tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .signers([wallet])
      .rpc();
    await conn.confirmTransaction(revealTx, "confirmed");
    txHashes.push({ step: "reveal", tx: revealTx });
    const balAfter = Number((await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    const reward = (balAfter - balBefore) / 1e9;
    console.log(`  [${walletName}][${puzzleId}] Reveal: ${revealTx.slice(0, 16)}... | +${reward} ECASH`);

    return { success: true, txHashes, reward, wallet: walletName };
  } catch (e) {
    return { success: false, error: e.message.slice(0, 80), txHashes, wallet: walletName };
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 17: SILVER TIER (MULTI-WALLET)");
  console.log("=".repeat(60));

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const w3 = loadWallet("wallet-3");

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(w3), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const prog = new anchor.Program(idl, provider);

  const [gsPda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_ID);

  // Check W3 state
  const minerPda = PublicKey.findProgramAddressSync([MINER_STATE_SEED, w3.publicKey.toBuffer()], PROGRAM_ID)[0];
  let minerState = await prog.account.minerState.fetch(minerPda);
  const initialSolves = minerState.solveCount.toNumber();

  console.log(`\nW3 address: ${w3.publicKey.toString()}`);
  console.log(`W3 solves: ${initialSolves}`);
  console.log(`Target: 10 (Silver tier)`);
  console.log(`Need: ${Math.max(0, 10 - initialSolves)} more`);
  log("17A.1", "Initial state", "Known", `W3 has ${initialSolves} solves`, null, true);

  // Find unsolved puzzles
  const gs = await prog.account.globalState.fetch(gsPda);
  const currentBatch = gs.currentBatch.toNumber();
  const batchStart = currentBatch * 10;

  const unsolved = [];
  for (let i = batchStart; i < batchStart + 10; i++) {
    const puzzleSolvedPda = PublicKey.findProgramAddressSync([PUZZLE_SOLVED_SEED, new BN(i).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];
    try {
      await prog.account.puzzleSolved.fetch(puzzleSolvedPda);
    } catch {
      if (puzzles[i]) unsolved.push(i);
    }
    await new Promise(r => setTimeout(r, 150));
  }
  console.log(`\nUnsolved puzzles in batch ${currentBatch}: ${unsolved.join(", ")}`);

  // Solve with W3
  console.log("\n--- Solving with W3 ---\n");
  const allTx = [];
  let solveCount = initialSolves;
  let testNum = 1;

  for (const puzzleId of unsolved) {
    if (solveCount >= 10) break;

    console.log(`\n=== Puzzle ${puzzleId} (${solveCount + 1}/10 target) ===`);
    const result = await solvePuzzle(conn, prog, w3, "W3", puzzleId, gsPda, vaultPda);

    if (result.success) {
      solveCount++;
      for (const tx of result.txHashes) {
        allTx.push({ wallet: "W3", puzzle: puzzleId, ...tx });
      }
      log(`17B.${testNum++}`, `Solve puzzle ${puzzleId}`, "Success", `W3 solved (+${result.reward} ECASH)`,
          result.txHashes.find(t => t.step === "reveal")?.tx, true);
    } else {
      log(`17B.${testNum++}`, `Solve puzzle ${puzzleId}`, "Success", result.error, null, false);
      if (result.error.includes("LockedOut") || result.error.includes("locked")) {
        console.log("*** W3 LOCKED OUT ***");
        break;
      }
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Final state
  console.log("\n--- Final State ---\n");
  minerState = await prog.account.minerState.fetch(minerPda);
  const finalSolves = minerState.solveCount.toNumber();
  const tier = finalSolves >= 50 ? "Diamond" : finalSolves >= 25 ? "Gold" : finalSolves >= 10 ? "Silver" : finalSolves >= 1 ? "Bronze" : "None";
  console.log(`W3 final solves: ${finalSolves}`);
  console.log(`W3 tier: ${tier}`);
  log("17C.1", "Silver tier achieved", "10+ solves", `${finalSolves} solves (${tier})`, null, finalSolves >= 10);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 17 RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${pass} | Failed: ${fail}`);

  console.log("\n--- Transaction Log ---");
  for (const tx of allTx) {
    console.log(`  ${tx.wallet} Puzzle ${tx.puzzle} ${tx.step}: ${tx.tx}`);
  }

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let content = `\n---\n\n## PHASE 17: Silver Tier (Multi-Wallet)\n\n`;
  content += `**Target Wallet**: W3 (${w3.publicKey.toString().slice(0, 12)}...)\n`;
  content += `**Final Solves**: ${finalSolves}\n`;
  content += `**Tier**: ${tier}\n\n`;
  content += `### Transactions\n\n`;
  content += `| Wallet | Puzzle | Step | TX |\n|--------|--------|------|----|\n`;
  for (const tx of allTx) {
    content += `| ${tx.wallet} | ${tx.puzzle} | ${tx.step} | [${tx.tx.slice(0, 8)}...](https://solscan.io/tx/${tx.tx}) |\n`;
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

  if (finalSolves < 10) {
    console.log("\n*** NOTE: Did not reach Silver tier ***");
    console.log("Wallets get locked out after each solve.");
    console.log("Need to wait 24 hours or use fresh wallets.");
  }
}

main().catch(console.error);
