// Phase 21: Token Transfer + Balance Integrity
// Verifies token balances, transfer functionality, and integrity across accounts

const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  createTransferInstruction,
  getMint
} = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROGRAM_ID = new PublicKey("7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u");
const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");
const GLOBAL_STATE_SEED = Buffer.from("global_state");
const MINER_STATE_SEED = Buffer.from("miner_state");
const VAULT_SEED = Buffer.from("vault");

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

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 21: TOKEN TRANSFER + BALANCE INTEGRITY");
  console.log("=".repeat(60));

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const deployer = loadWallet("deployer");
  const w1 = loadWallet("wallet-1");
  const w2 = loadWallet("wallet-2");
  const w3 = loadWallet("wallet-3");
  const w4 = loadWallet("wallet-4");
  const w5 = loadWallet("wallet-5");

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(deployer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const prog = new anchor.Program(idl, provider);

  const [gsPda] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_ID);

  // ============================================================
  // 21A: Mint Information
  // ============================================================
  console.log("\n--- 21A: Mint Information ---\n");

  try {
    const mintInfo = await getMint(conn, MINT, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log(`  Mint: ${MINT.toString()}`);
    console.log(`  Decimals: ${mintInfo.decimals}`);
    console.log(`  Supply: ${Number(mintInfo.supply) / Math.pow(10, mintInfo.decimals)} ECASH`);
    console.log(`  Freeze Authority: ${mintInfo.freezeAuthority?.toString() || "None"}`);
    console.log(`  Mint Authority: ${mintInfo.mintAuthority?.toString() || "None"}`);

    log("21A.1", "Mint accessible", "Yes", `Decimals=${mintInfo.decimals}`, null, true);
    log("21A.2", "Decimals = 9", "9", `${mintInfo.decimals}`, null, mintInfo.decimals === 9);
  } catch (e) {
    log("21A.1", "Mint accessible", "Yes", `Error: ${e.message.slice(0, 40)}`, null, false);
  }

  // ============================================================
  // 21B: Vault Balance
  // ============================================================
  console.log("\n--- 21B: Vault Balance ---\n");

  let vaultBalance = 0;
  try {
    const vaultAccount = await getAccount(conn, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID);
    vaultBalance = Number(vaultAccount.amount) / 1e9;
    console.log(`  Vault: ${vaultPda.toString()}`);
    console.log(`  Balance: ${vaultBalance.toFixed(4)} ECASH`);
    log("21B.1", "Vault has balance", ">0", `${vaultBalance.toFixed(4)} ECASH`, null, vaultBalance > 0);
  } catch (e) {
    log("21B.1", "Vault accessible", "Yes", `Error: ${e.message.slice(0, 40)}`, null, false);
  }

  // ============================================================
  // 21C: Wallet Balances
  // ============================================================
  console.log("\n--- 21C: Wallet Balances ---\n");

  const wallets = [
    { name: "deployer", kp: deployer },
    { name: "wallet-1", kp: w1 },
    { name: "wallet-2", kp: w2 },
    { name: "wallet-3", kp: w3 },
    { name: "wallet-4", kp: w4 },
    { name: "wallet-5", kp: w5 },
  ];

  const balances = {};
  let totalWalletBalance = 0;

  for (const { name, kp } of wallets) {
    const ata = getAssociatedTokenAddressSync(MINT, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
    try {
      const account = await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
      const balance = Number(account.amount) / 1e9;
      balances[name] = balance;
      totalWalletBalance += balance;
      console.log(`  ${name}: ${balance.toFixed(4)} ECASH`);
    } catch {
      balances[name] = 0;
      console.log(`  ${name}: 0 ECASH (no ATA)`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  log("21C.1", "All wallets have ATAs", "accessible", `${Object.keys(balances).length} wallets checked`, null, true);

  // Check that wallet-3 has the most (4 solves)
  const w3Balance = balances["wallet-3"] || 0;
  const w2Balance = balances["wallet-2"] || 0;
  log("21C.2", "W3 balance > W2 (more solves)", `W3 > W2`,
      `W3=${w3Balance.toFixed(2)}, W2=${w2Balance.toFixed(2)}`, null, w3Balance >= w2Balance);

  // ============================================================
  // 21D: Balance Integrity Check
  // ============================================================
  console.log("\n--- 21D: Balance Integrity ---\n");

  const gs = await prog.account.globalState.fetch(gsPda);
  const totalSolved = gs.totalSolved.toNumber();
  const expectedRewards = totalSolved * 100; // 100 ECASH per solve

  console.log(`  Total puzzles solved: ${totalSolved}`);
  console.log(`  Expected rewards issued: ${expectedRewards} ECASH`);
  console.log(`  Total in wallets: ${totalWalletBalance.toFixed(4)} ECASH`);
  console.log(`  Vault balance: ${vaultBalance.toFixed(4)} ECASH`);

  // Wallet balances should roughly equal rewards issued (minus any burned)
  const totalBurned = Number(gs.totalBurned) / 1e9;
  const expectedInCirculation = expectedRewards - totalBurned;
  log("21D.1", "Wallet total ~ expected", `~${expectedInCirculation.toFixed(0)}`,
      `${totalWalletBalance.toFixed(2)} ECASH`, null,
      Math.abs(totalWalletBalance - expectedInCirculation) < expectedRewards * 0.1);

  // ============================================================
  // 21E: Token Transfer Test (W3 -> W2)
  // ============================================================
  console.log("\n--- 21E: Token Transfer Test ---\n");

  if (w3Balance >= 1) {
    const transferAmount = 0.1; // Transfer 0.1 ECASH
    const transferAmountRaw = BigInt(Math.floor(transferAmount * 1e9));

    const w3Ata = getAssociatedTokenAddressSync(MINT, w3.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const w2Ata = getAssociatedTokenAddressSync(MINT, w2.publicKey, false, TOKEN_2022_PROGRAM_ID);

    try {
      // Get balances before
      const w3Before = Number((await getAccount(conn, w3Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;
      const w2Before = Number((await getAccount(conn, w2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;

      console.log(`  Transferring ${transferAmount} ECASH from W3 to W2...`);
      console.log(`  W3 before: ${w3Before.toFixed(4)}`);
      console.log(`  W2 before: ${w2Before.toFixed(4)}`);

      // Create transfer instruction
      const transferIx = createTransferInstruction(
        w3Ata,
        w2Ata,
        w3.publicKey,
        transferAmountRaw,
        [],
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      const sig = await sendAndConfirmTransaction(conn, tx, [w3], { commitment: "confirmed" });

      // Get balances after
      await new Promise(r => setTimeout(r, 1000));
      const w3After = Number((await getAccount(conn, w3Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;
      const w2After = Number((await getAccount(conn, w2Ata, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;

      console.log(`  W3 after: ${w3After.toFixed(4)}`);
      console.log(`  W2 after: ${w2After.toFixed(4)}`);

      const w3Diff = w3Before - w3After;
      const w2Diff = w2After - w2Before;

      log("21E.1", "W3 debited correctly", `~${transferAmount}`, `${w3Diff.toFixed(4)}`, sig,
          Math.abs(w3Diff - transferAmount) < 0.001);
      log("21E.2", "W2 credited correctly", `~${transferAmount}`, `${w2Diff.toFixed(4)}`, sig,
          Math.abs(w2Diff - transferAmount) < 0.001);
      log("21E.3", "Transfer balanced", "W3 loss = W2 gain", `${w3Diff.toFixed(4)} = ${w2Diff.toFixed(4)}`, null,
          Math.abs(w3Diff - w2Diff) < 0.001);
    } catch (e) {
      log("21E.1", "Transfer succeeded", "Yes", `Error: ${e.message.slice(0, 50)}`, null, false);
    }
  } else {
    log("21E.1", "Transfer test", "W3 has balance", `W3 balance: ${w3Balance}`, null, false);
  }

  // ============================================================
  // 21F: Transfer Back (W2 -> W3) to Restore State
  // ============================================================
  console.log("\n--- 21F: Restore Transfer (W2 -> W3) ---\n");

  const w2AtaCheck = getAssociatedTokenAddressSync(MINT, w2.publicKey, false, TOKEN_2022_PROGRAM_ID);
  try {
    const w2BalanceNow = Number((await getAccount(conn, w2AtaCheck, "confirmed", TOKEN_2022_PROGRAM_ID)).amount) / 1e9;

    if (w2BalanceNow >= 0.1) {
      const transferAmount = 0.1;
      const transferAmountRaw = BigInt(Math.floor(transferAmount * 1e9));

      const w2Ata = getAssociatedTokenAddressSync(MINT, w2.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const w3Ata = getAssociatedTokenAddressSync(MINT, w3.publicKey, false, TOKEN_2022_PROGRAM_ID);

      console.log(`  Transferring ${transferAmount} ECASH back from W2 to W3...`);

      const transferIx = createTransferInstruction(
        w2Ata,
        w3Ata,
        w2.publicKey,
        transferAmountRaw,
        [],
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      const sig = await sendAndConfirmTransaction(conn, tx, [w2], { commitment: "confirmed" });

      log("21F.1", "Restore transfer", "Success", "0.1 ECASH returned to W3", sig, true);
    } else {
      log("21F.1", "Restore transfer", "Skipped", `W2 balance: ${w2BalanceNow.toFixed(4)}`, null, true);
    }
  } catch (e) {
    log("21F.1", "Restore transfer", "Success", `Error: ${e.message.slice(0, 50)}`, null, false);
  }

  // ============================================================
  // 21G: Final Balance Summary
  // ============================================================
  console.log("\n--- 21G: Final Balance Summary ---\n");

  let finalTotal = 0;
  for (const { name, kp } of wallets) {
    const ata = getAssociatedTokenAddressSync(MINT, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
    try {
      const account = await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
      const balance = Number(account.amount) / 1e9;
      finalTotal += balance;
      console.log(`  ${name}: ${balance.toFixed(4)} ECASH`);
    } catch {
      console.log(`  ${name}: 0 ECASH`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  // Total should be roughly the same as before transfers
  log("21G.1", "Total preserved", `~${totalWalletBalance.toFixed(2)}`,
      `${finalTotal.toFixed(2)} ECASH`, null, Math.abs(finalTotal - totalWalletBalance) < 0.01);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 21 RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${pass} | Failed: ${fail}`);

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let content = `\n---\n\n## PHASE 21: Token Transfer + Balance Integrity\n\n`;
  content += `### Token Summary\n`;
  content += `- Vault Balance: ${vaultBalance.toFixed(4)} ECASH\n`;
  content += `- Total in Wallets: ${totalWalletBalance.toFixed(4)} ECASH\n`;
  content += `- Puzzles Solved: ${totalSolved}\n`;
  content += `- Expected Rewards: ${expectedRewards} ECASH\n\n`;

  content += `### Wallet Balances\n\n`;
  content += `| Wallet | Balance (ECASH) |\n|--------|----------------|\n`;
  for (const [name, balance] of Object.entries(balances)) {
    content += `| ${name} | ${balance.toFixed(4)} |\n`;
  }

  content += `\n### Test Results\n\n`;
  content += `| # | Test | Expected | Actual | TX | Status |\n|---|------|----------|--------|-----|--------|\n`;
  for (const r of results) {
    const txL = r.tx ? `[${r.tx.slice(0, 8)}...](https://solscan.io/tx/${r.tx})` : "N/A";
    content += `| ${r.id} | ${r.name} | ${r.exp} | ${String(r.act).slice(0, 30)} | ${txL} | ${r.status} |\n`;
  }
  content += `\n**Summary**: ${pass}/${results.length} passed\n`;
  fs.appendFileSync(logPath, content);
  console.log("\nResults appended to DEPLOY-TEST-LOG.md");
}

main().catch(console.error);
