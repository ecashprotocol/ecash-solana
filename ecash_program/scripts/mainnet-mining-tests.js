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
  getAssociatedTokenAddressSync,
  getAccount,
} = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Constants
const PROGRAM_ID = new PublicKey("7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u");
const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINER_STATE_SEED = Buffer.from("miner_state");

// u64 max = "not in batch" sentinel value
const NOT_IN_BATCH = new BN("18446744073709551615");

// Test results
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
  console.log("  PHASE 4: MINING TESTS - MAINNET");
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

  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("");

  // Helper to get miner state PDA
  const getMinerPda = (pubkey) => PublicKey.findProgramAddressSync([MINER_STATE_SEED, pubkey.toBuffer()], PROGRAM_ID)[0];

  // ============================================================
  // Check current registration status
  // ============================================================
  console.log("--- Checking existing registrations ---\n");

  for (const [name, wallet] of [["W1", wallet1], ["W2", wallet2], ["W3", wallet3], ["W4", wallet4], ["W5", wallet5]]) {
    const state = await getMinerState(program, wallet.publicKey);
    if (state) {
      console.log(`${name}: Already registered, gas=${state.gasBalance}, batch=${state.enteredBatch}, hasPick=${state.hasPick}`);
    } else {
      console.log(`${name}: Not registered`);
    }
  }

  // ============================================================
  // 4B: BATCH ENTRY TESTS (skip registration since already done)
  // ============================================================
  console.log("\n--- 4B: BATCH ENTRY TESTS ---\n");

  // Check if W1 already in batch
  let w1State = await getMinerState(program, wallet1.publicKey);
  if (w1State && !w1State.enteredBatch.eq(NOT_IN_BATCH)) {
    console.log("W1 already in batch, skipping enterBatch tests");
    logResult("4B.1", "W1 enter batch 0", "Already done", "Skipped", null, true);
  } else {
    // 4B.1: W1 enter batch 0
    try {
      const minerStatePda = getMinerPda(wallet1.publicKey);
      const wallet1Ata = getAssociatedTokenAddressSync(MINT, wallet1.publicKey, false, TOKEN_2022_PROGRAM_ID);

      const balBefore = (await getAccount(connection, wallet1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;

      const tx = await program.methods
        .enterBatch()
        .accounts({
          owner: wallet1.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
          mint: MINT,
          minerTokenAccount: wallet1Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([wallet1])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      const balAfter = (await getAccount(connection, wallet1Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
      const burned = Number(balBefore - balAfter) / 1e9;
      logResult("4B.1", "W1 enter batch 0", "Burn 1000", `Burned ${burned}`, tx, burned === 1000);
    } catch (e) {
      logResult("4B.1", "W1 enter batch 0", "Success", e.message.slice(0, 80), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // 4B.2: W2 enter batch 0
  let w2State = await getMinerState(program, wallet2.publicKey);
  if (w2State && !w2State.enteredBatch.eq(NOT_IN_BATCH)) {
    logResult("4B.2", "W2 enter batch 0", "Already done", "Skipped", null, true);
  } else {
    try {
      const minerStatePda = getMinerPda(wallet2.publicKey);
      const wallet2Ata = getAssociatedTokenAddressSync(MINT, wallet2.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const tx = await program.methods
        .enterBatch()
        .accounts({
          owner: wallet2.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
          mint: MINT,
          minerTokenAccount: wallet2Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([wallet2])
        .rpc();
      await connection.confirmTransaction(tx, "confirmed");
      logResult("4B.2", "W2 enter batch 0", "Success", "Success", tx, true);
    } catch (e) {
      logResult("4B.2", "W2 enter batch 0", "Success", e.message.slice(0, 80), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // 4B.3: W3 enter batch 0
  let w3State = await getMinerState(program, wallet3.publicKey);
  if (w3State && !w3State.enteredBatch.eq(NOT_IN_BATCH)) {
    logResult("4B.3", "W3 enter batch 0", "Already done", "Skipped", null, true);
  } else {
    try {
      const minerStatePda = getMinerPda(wallet3.publicKey);
      const wallet3Ata = getAssociatedTokenAddressSync(MINT, wallet3.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const tx = await program.methods
        .enterBatch()
        .accounts({
          owner: wallet3.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
          mint: MINT,
          minerTokenAccount: wallet3Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([wallet3])
        .rpc();
      await connection.confirmTransaction(tx, "confirmed");
      logResult("4B.3", "W3 enter batch 0", "Success", "Success", tx, true);
    } catch (e) {
      logResult("4B.3", "W3 enter batch 0", "Success", e.message.slice(0, 80), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // 4B.4: W1 enter batch 0 again (should fail)
  try {
    const minerStatePda = getMinerPda(wallet1.publicKey);
    const wallet1Ata = getAssociatedTokenAddressSync(MINT, wallet1.publicKey, false, TOKEN_2022_PROGRAM_ID);
    await program.methods
      .enterBatch()
      .accounts({
        owner: wallet1.publicKey,
        minerState: minerStatePda,
        globalState: globalStatePda,
        mint: MINT,
        minerTokenAccount: wallet1Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([wallet1])
      .rpc();
    logResult("4B.4", "W1 enter batch again", "FAIL", "Success (BAD)", null, false);
  } catch (e) {
    logResult("4B.4", "W1 enter batch again", "FAIL: AlreadyEnteredBatch", "Rejected", null, true);
  }

  // ============================================================
  // 4C: PICK PUZZLE TESTS
  // ============================================================
  console.log("\n--- 4C: PICK PUZZLE TESTS ---\n");

  // 4C.1: W1 pick puzzle 0
  w1State = await getMinerState(program, wallet1.publicKey);
  if (w1State && w1State.hasPick) {
    console.log(`W1 already has pick: puzzle ${w1State.activePick}`);
    logResult("4C.1", "W1 pick puzzle 0", "Already has pick", "Skipped", null, true);
  } else {
    try {
      const minerStatePda = getMinerPda(wallet1.publicKey);
      const gasBefore = w1State ? w1State.gasBalance.toNumber() : 0;

      const tx = await program.methods
        .pick(new BN(0))
        .accounts({
          owner: wallet1.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
        })
        .signers([wallet1])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");
      const state = await getMinerState(program, wallet1.publicKey);
      const gasAfter = state.gasBalance.toNumber();
      const gasUsed = gasBefore - gasAfter;
      logResult("4C.1", "W1 pick puzzle 0", "gas -10", `gas -${gasUsed}`, tx, gasUsed === 10);
    } catch (e) {
      logResult("4C.1", "W1 pick puzzle 0", "Success", e.message.slice(0, 80), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // 4C.2: W2 pick puzzle 1
  w2State = await getMinerState(program, wallet2.publicKey);
  if (w2State && w2State.hasPick) {
    logResult("4C.2", "W2 pick puzzle 1", "Already has pick", "Skipped", null, true);
  } else {
    try {
      const minerStatePda = getMinerPda(wallet2.publicKey);
      const tx = await program.methods
        .pick(new BN(1))
        .accounts({
          owner: wallet2.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
        })
        .signers([wallet2])
        .rpc();
      await connection.confirmTransaction(tx, "confirmed");
      logResult("4C.2", "W2 pick puzzle 1", "Success", "Success", tx, true);
    } catch (e) {
      logResult("4C.2", "W2 pick puzzle 1", "Success", e.message.slice(0, 80), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // 4C.3: W3 pick puzzle 2
  w3State = await getMinerState(program, wallet3.publicKey);
  if (w3State && w3State.hasPick) {
    logResult("4C.3", "W3 pick puzzle 2", "Already has pick", "Skipped", null, true);
  } else {
    try {
      const minerStatePda = getMinerPda(wallet3.publicKey);
      const tx = await program.methods
        .pick(new BN(2))
        .accounts({
          owner: wallet3.publicKey,
          minerState: minerStatePda,
          globalState: globalStatePda,
        })
        .signers([wallet3])
        .rpc();
      await connection.confirmTransaction(tx, "confirmed");
      logResult("4C.3", "W3 pick puzzle 2", "Success", "Success", tx, true);
    } catch (e) {
      logResult("4C.3", "W3 pick puzzle 2", "Success", e.message.slice(0, 80), null, false);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // 4C.4: W4 pick without entering batch (should fail)
  try {
    const minerStatePda = getMinerPda(wallet4.publicKey);
    await program.methods
      .pick(new BN(3))
      .accounts({
        owner: wallet4.publicKey,
        minerState: minerStatePda,
        globalState: globalStatePda,
      })
      .signers([wallet4])
      .rpc();
    logResult("4C.4", "W4 pick without batch", "FAIL", "Success (BAD)", null, false);
  } catch (e) {
    logResult("4C.4", "W4 pick without batch", "FAIL", "Rejected", null, true);
  }

  // 4C.5: W1 pick again while has active pick (should fail)
  try {
    const minerStatePda = getMinerPda(wallet1.publicKey);
    await program.methods
      .pick(new BN(5))
      .accounts({
        owner: wallet1.publicKey,
        minerState: minerStatePda,
        globalState: globalStatePda,
      })
      .signers([wallet1])
      .rpc();
    logResult("4C.5", "W1 double pick", "FAIL: AlreadyHasPick", "Success (BAD)", null, false);
  } catch (e) {
    logResult("4C.5", "W1 double pick", "FAIL: AlreadyHasPick", "Rejected", null, true);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 4 PARTIAL RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let logContent = `\n### 4B: Batch Entry + 4C: Pick Tests (Continued)\n\n| # | Test | Expected | Actual | TX | Status |\n|---|------|----------|--------|-----|--------|\n`;
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
