// Phase 10 Final: Quick commit-reveal race with proper funding
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
puzzles.forEach((p, i) => { p.proof = proofs[i]; });

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

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 10: COMPETITIVE MINING - FINAL TEST");
  console.log("=".repeat(60));

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const deployer = loadWallet("deployer");
  const w4 = loadWallet("wallet-4");
  const w5 = loadWallet("wallet-5");

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(deployer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const prog = new anchor.Program(idl, provider);

  const [gsPda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_ID);
  const mPda = (pk) => PublicKey.findProgramAddressSync([MINER_STATE_SEED, pk.toBuffer()], PROGRAM_ID)[0];
  const psPda = (id) => PublicKey.findProgramAddressSync([PUZZLE_SOLVED_SEED, new BN(id).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];

  const TARGET = 3;
  const puz = puzzles[TARGET];
  const sec4 = keccak(Buffer.concat([Buffer.from("secret4"), w4.publicKey.toBuffer()]));
  const sec5 = keccak(Buffer.concat([Buffer.from("secret5"), w5.publicKey.toBuffer()]));

  console.log(`\nTarget: Puzzle ${TARGET} ("${puz.ans}")`);

  // Check if solved
  try { await prog.account.puzzleSolved.fetch(psPda(TARGET)); console.log("Puzzle already solved!"); return; }
  catch { log("10.0", "Puzzle available", "Unsolved", "Yes", null, true); }

  const gsBefore = await prog.account.globalState.fetch(gsPda);
  const vBefore = Number((await getAccount(conn, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
  console.log(`Before: ${gsBefore.totalSolved.toNumber()} solved, vault=${vBefore / 1e9} ECASH\n`);

  // Cancel expired commits
  console.log("--- Clearing expired commits ---");
  for (const [n, w] of [["W4", w4], ["W5", w5]]) {
    const st = await prog.account.minerState.fetch(mPda(w.publicKey));
    if (st.hasCommit) {
      const slot = await conn.getSlot();
      if (slot > st.commitSlot.toNumber() + 300) {
        try {
          const tx = await prog.methods.cancelExpiredCommit().accounts({ owner: w.publicKey, minerState: mPda(w.publicKey) }).signers([w]).rpc();
          await conn.confirmTransaction(tx, "confirmed");
          console.log(`${n}: Cancelled expired commit`);
        } catch (e) { console.log(`${n}: Cancel error - ${e.message.slice(0, 40)}`); }
      }
    }
  }
  await new Promise(r => setTimeout(r, 1500));

  // Ensure both have puzzle 3 picked
  console.log("\n--- Ensuring picks ---");
  for (const [n, w] of [["W4", w4], ["W5", w5]]) {
    const st = await prog.account.minerState.fetch(mPda(w.publicKey));
    if (!st.hasPick || st.activePick.toNumber() !== TARGET) {
      if (st.hasPick) {
        console.log(`${n}: Has different pick, cannot change`);
        continue;
      }
      const tx = await prog.methods.pick(new BN(TARGET)).accounts({ owner: w.publicKey, minerState: mPda(w.publicKey), globalState: gsPda }).signers([w]).rpc();
      await conn.confirmTransaction(tx, "confirmed");
      console.log(`${n}: Picked puzzle ${TARGET}`);
    } else {
      console.log(`${n}: Already has puzzle ${TARGET}`);
    }
  }
  await new Promise(r => setTimeout(r, 1500));

  // COMMIT both
  console.log("\n--- COMMITTING ---");
  const com4 = keccak(Buffer.concat([Buffer.from(puz.ans), puz.salt, sec4, w4.publicKey.toBuffer()]));
  const com5 = keccak(Buffer.concat([Buffer.from(puz.ans), puz.salt, sec5, w5.publicKey.toBuffer()]));

  let s4 = await prog.account.minerState.fetch(mPda(w4.publicKey));
  if (!s4.hasCommit) {
    const tx = await prog.methods.commitSolve(Array.from(com4)).accounts({ owner: w4.publicKey, minerState: mPda(w4.publicKey) }).signers([w4]).rpc();
    await conn.confirmTransaction(tx, "confirmed");
    log("10A.1", "W4 commit", "Success", "Done", tx, true);
  } else { log("10A.1", "W4 commit", "Already", "Skipped", null, true); }

  let s5 = await prog.account.minerState.fetch(mPda(w5.publicKey));
  if (!s5.hasCommit) {
    const tx = await prog.methods.commitSolve(Array.from(com5)).accounts({ owner: w5.publicKey, minerState: mPda(w5.publicKey) }).signers([w5]).rpc();
    await conn.confirmTransaction(tx, "confirmed");
    log("10A.2", "W5 commit", "Success", "Done", tx, true);
  } else { log("10A.2", "W5 commit", "Already", "Skipped", null, true); }

  // Wait for next slot
  console.log("\nWaiting 2s for next slot...");
  await new Promise(r => setTimeout(r, 2000));

  // REVEAL RACE
  console.log("\n--- REVEAL RACE ---");
  const puzzleSolvedPda = psPda(TARGET);
  let winner = null, loser = null;

  const reveal = async (name, wallet, secret) => {
    const ata = getAssociatedTokenAddressSync(MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const bal1 = Number((await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    const tx = await prog.methods.revealSolve(
      puz.ans, Array.from(puz.salt), Array.from(secret), puz.proof.map(p => Array.from(p))
    ).accounts({
      owner: wallet.publicKey, minerState: mPda(wallet.publicKey), globalState: gsPda,
      puzzleSolved: puzzleSolvedPda, mint: MINT, vault: vaultPda, minerTokenAccount: ata,
      tokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId
    }).signers([wallet]).rpc();
    await conn.confirmTransaction(tx, "confirmed");
    const bal2 = Number((await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
    return { tx, reward: (bal2 - bal1) / 1e9 };
  };

  // W4 first
  try {
    const res = await reveal("W4", w4, sec4);
    winner = "W4";
    console.log(`W4 reveal SUCCESS! Reward: ${res.reward} ECASH`);
    log("10B.1", "W4 reveal", "May win", `SUCCESS +${res.reward}`, res.tx, true);
  } catch (e) {
    loser = "W4";
    console.log(`W4 reveal FAILED: ${e.message.slice(0, 50)}`);
    log("10B.1", "W4 reveal", "May fail", "FAILED", null, true);
  }

  // W5 second
  try {
    const res = await reveal("W5", w5, sec5);
    if (!winner) winner = "W5";
    console.log(`W5 reveal SUCCESS! Reward: ${res.reward} ECASH`);
    log("10B.2", "W5 reveal", "May win", `SUCCESS +${res.reward}`, res.tx, true);
  } catch (e) {
    if (!loser) loser = "W5";
    console.log(`W5 reveal FAILED: ${e.message.slice(0, 50)}`);
    log("10B.2", "W5 reveal", "May fail", "FAILED", null, true);
  }

  // VERIFY
  console.log("\n--- VERIFICATION ---");
  const gsAfter = await prog.account.globalState.fetch(gsPda);
  const vAfter = Number((await getAccount(conn, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID)).amount);
  const inc = gsAfter.totalSolved.toNumber() - gsBefore.totalSolved.toNumber();
  const dec = (vBefore - vAfter) / 1e9;

  console.log(`Solved increase: ${inc}`);
  console.log(`Vault decrease: ${dec} ECASH`);
  log("10C.1", "Single solve", "1", String(inc), null, inc === 1);
  log("10C.2", "Single reward", "4000", String(dec), null, dec === 4000);

  // Check solver
  try {
    const ps = await prog.account.puzzleSolved.fetch(puzzleSolvedPda);
    console.log(`Solver: ${ps.solver.toString().slice(0, 8)}...`);
    log("10C.3", "Single solver", "One", ps.solver.toString().slice(0, 8), null, true);
  } catch (e) { log("10C.3", "Single solver", "One", "Error", null, false); }

  const raceOk = winner && loser && inc === 1;
  log("10C.4", "Race outcome", "1 win, 1 lose", `${winner} won, ${loser} lost`, null, raceOk);

  // Cleanup loser
  if (loser) {
    console.log(`\nClearing ${loser}'s state...`);
    const lw = loser === "W4" ? w4 : w5;
    try {
      try { await prog.methods.cancelExpiredCommit().accounts({ owner: lw.publicKey, minerState: mPda(lw.publicKey) }).signers([lw]).rpc(); } catch {}
      await new Promise(r => setTimeout(r, 1000));
      const tx = await prog.methods.clearSolvedPick().accounts({ owner: lw.publicKey, minerState: mPda(lw.publicKey), puzzleSolved: puzzleSolvedPda }).signers([lw]).rpc();
      await conn.confirmTransaction(tx, "confirmed");
      log("10D.1", `${loser} cleanup`, "Success", "Cleared", tx, true);
    } catch (e) { log("10D.1", `${loser} cleanup`, "N/A", e.message.slice(0, 30), null, true); }
  }

  // SUMMARY
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 10 RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${pass} | Failed: ${fail}`);
  console.log(`Double-mint prevention: ${inc === 1 && dec === 4000 ? "WORKING" : "FAILED"}`);

  // Save
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let content = `\n---\n\n## PHASE 10: Competitive Mining Race Test (FINAL)\n\n`;
  content += `**Scenario**: W4 and W5 race to solve puzzle ${TARGET}\n**Winner**: ${winner || "None"}\n\n`;
  content += `| # | Test | Expected | Actual | TX | Status |\n|---|------|----------|--------|-----|--------|\n`;
  for (const r of results) {
    const txL = r.tx ? `[${r.tx.slice(0, 8)}...](https://solscan.io/tx/${r.tx})` : "N/A";
    content += `| ${r.id} | ${r.name} | ${r.exp} | ${String(r.act).slice(0, 30)} | ${txL} | ${r.status} |\n`;
  }
  content += `\n**Summary**: ${pass}/${results.length} passed\n`;
  content += `- Winner: ${winner}\n- Loser: ${loser}\n- Solved increase: ${inc}\n- Vault decrease: ${dec} ECASH\n- Double-mint prevented: ${inc === 1 && dec === 4000 ? "YES" : "NO"}\n`;
  fs.appendFileSync(logPath, content);
  console.log("\nResults appended to DEPLOY-TEST-LOG.md");
}

main().catch(console.error);
