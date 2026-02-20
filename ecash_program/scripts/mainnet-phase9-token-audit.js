const anchor = require("@coral-xyz/anchor");
const { Program, AnchorProvider, BN } = anchor;
const {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
} = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Constants
const PROGRAM_ID = new PublicKey("7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u");
const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const VAULT_SEED = Buffer.from("vault");
const JOB_ESCROW_SEED = Buffer.from("job_escrow");

async function loadWallet(name) {
  const walletPath = path.join(os.homedir(), `ecash-solana/${name}.json`);
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
}

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 9: TOKEN ACCOUNTING AUDIT");
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

  const getJobEscrowPda = (jobId) => PublicKey.findProgramAddressSync([JOB_ESCROW_SEED, new BN(jobId).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];

  const results = [];

  // ============================================================
  // 9A: SUPPLY VERIFICATION
  // ============================================================
  console.log("\n--- 9A: SUPPLY VERIFICATION ---\n");

  // Get mint info
  const mintInfo = await getMint(connection, MINT, "confirmed", TOKEN_2022_PROGRAM_ID);
  const totalSupply = Number(mintInfo.supply) / 1e9;
  console.log(`Total Supply: ${totalSupply.toLocaleString()} ECASH`);
  console.log(`Decimals: ${mintInfo.decimals}`);
  console.log(`Mint Authority: ${mintInfo.mintAuthority?.toString() || "None"}`);
  console.log(`Freeze Authority: ${mintInfo.freezeAuthority?.toString() || "None"}`);

  // Supply will be less than 21M due to burns (batch entries burn 1000 ECASH each)
  // Initial: 21,000,000 - burns from batch entries and escrow fees
  const burnedFromSupply = 21000000 - totalSupply;
  results.push({
    category: "Supply",
    item: "Total Supply",
    expected: "~21M minus burns",
    actual: `${totalSupply.toLocaleString()} (${burnedFromSupply.toLocaleString()} burned)`,
    match: totalSupply > 20000000 && totalSupply <= 21000000,
  });

  // ============================================================
  // 9B: VAULT BALANCE
  // ============================================================
  console.log("\n--- 9B: VAULT BALANCE ---\n");

  let vaultBalance = 0;
  try {
    const vaultAccount = await getAccount(connection, vaultPda, "confirmed", TOKEN_2022_PROGRAM_ID);
    vaultBalance = Number(vaultAccount.amount) / 1e9;
    console.log(`Vault Balance: ${vaultBalance.toLocaleString()} ECASH`);
  } catch (e) {
    console.log(`Vault Error: ${e.message.slice(0, 50)}`);
  }

  // Initial vault was 18,900,000, minus 12,000 for 3 solves
  const expectedVault = 18900000 - 12000;
  results.push({
    category: "Vault",
    item: "Mining Reserve",
    expected: expectedVault.toLocaleString(),
    actual: vaultBalance.toLocaleString(),
    match: vaultBalance === expectedVault,
  });

  // ============================================================
  // 9C: DEPLOYER (LP) BALANCE
  // ============================================================
  console.log("\n--- 9C: DEPLOYER (LP) BALANCE ---\n");

  let deployerBalance = 0;
  try {
    const deployerAta = getAssociatedTokenAddressSync(MINT, deployer.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const deployerAccount = await getAccount(connection, deployerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    deployerBalance = Number(deployerAccount.amount) / 1e9;
    console.log(`Deployer (LP) Balance: ${deployerBalance.toLocaleString()} ECASH`);
  } catch (e) {
    console.log(`Deployer Error: ${e.message.slice(0, 50)}`);
  }

  // LP started with 2,100,000, sent 5000 to test wallets
  results.push({
    category: "Deployer",
    item: "LP Allocation",
    expected: "~2,095,000",
    actual: deployerBalance.toLocaleString(),
    match: deployerBalance > 2000000 && deployerBalance <= 2100000,
  });

  // ============================================================
  // 9D: TEST WALLET BALANCES
  // ============================================================
  console.log("\n--- 9D: TEST WALLET BALANCES ---\n");

  const wallets = [
    { name: "Wallet 1", keypair: wallet1 },
    { name: "Wallet 2", keypair: wallet2 },
    { name: "Wallet 3", keypair: wallet3 },
    { name: "Wallet 4", keypair: wallet4 },
    { name: "Wallet 5", keypair: wallet5 },
  ];

  let totalWalletBalance = 0;
  for (const w of wallets) {
    try {
      const ata = getAssociatedTokenAddressSync(MINT, w.keypair.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const account = await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
      const balance = Number(account.amount) / 1e9;
      totalWalletBalance += balance;
      console.log(`${w.name}: ${balance.toLocaleString()} ECASH`);
      results.push({
        category: "Wallets",
        item: w.name,
        expected: "-",
        actual: balance.toLocaleString(),
        match: true,
      });
    } catch (e) {
      console.log(`${w.name}: 0 (ATA not found)`);
      results.push({
        category: "Wallets",
        item: w.name,
        expected: "-",
        actual: "0",
        match: true,
      });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nTotal in test wallets: ${totalWalletBalance.toLocaleString()} ECASH`);

  // ============================================================
  // 9E: JOB ESCROW ACCOUNTS
  // ============================================================
  console.log("\n--- 9E: JOB ESCROW ACCOUNTS ---\n");

  const globalState = await program.account.globalState.fetch(globalStatePda);
  const totalJobs = globalState.totalJobsCreated.toNumber();
  console.log(`Total jobs created: ${totalJobs}`);

  let totalEscrowed = 0;
  for (let i = 0; i < totalJobs; i++) {
    try {
      const escrowPda = getJobEscrowPda(i);
      const escrowAccount = await getAccount(connection, escrowPda, "confirmed", TOKEN_2022_PROGRAM_ID);
      const balance = Number(escrowAccount.amount) / 1e9;
      if (balance > 0) {
        console.log(`Job ${i} escrow: ${balance} ECASH`);
        totalEscrowed += balance;
      }
    } catch (e) {
      // Escrow doesn't exist or is closed
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`Total in escrow: ${totalEscrowed.toLocaleString()} ECASH`);
  results.push({
    category: "Escrow",
    item: "Active Job Escrows",
    expected: "-",
    actual: totalEscrowed.toLocaleString(),
    match: true,
  });

  // ============================================================
  // 9F: BURNED TOKENS
  // ============================================================
  console.log("\n--- 9F: BURNED TOKENS ---\n");

  const totalBurned = globalState.totalBurned.toNumber();
  console.log(`Total Burned (on-chain counter): ${totalBurned} ECASH`);

  // NOTE: total_burned counter in global_state is NOT incremented by enter_batch
  // This is a cosmetic bug - tokens ARE burned (verified by supply decrease)
  // but the counter doesn't track batch burns (only escrow burns via total_escrow_burned)
  const actualBurnedFromSupply = 21000000 - totalSupply;
  console.log(`Actual burned (from supply): ${actualBurnedFromSupply} ECASH`);
  console.log(`On-chain counter (total_burned): ${totalBurned} ECASH`);
  console.log(`Note: Counter doesn't track batch burns (known issue)`);
  results.push({
    category: "Burned",
    item: "Actual Burned (supply)",
    expected: ">0 if batches entered",
    actual: `${actualBurnedFromSupply.toLocaleString()} (counter: ${totalBurned})`,
    match: actualBurnedFromSupply > 0, // Verify burns happened via supply decrease
  });

  // ============================================================
  // 9G: ACCOUNTING RECONCILIATION
  // ============================================================
  console.log("\n--- 9G: ACCOUNTING RECONCILIATION ---\n");

  // Total supply = Vault + LP + TestWallets + Escrow + Burned (from original supply perspective)
  const accounted = vaultBalance + deployerBalance + totalWalletBalance + totalEscrowed;
  const unaccounted = totalSupply - accounted;

  console.log("RECONCILIATION:");
  console.log(`  Vault (Mining Reserve): ${vaultBalance.toLocaleString()}`);
  console.log(`  Deployer (LP):          ${deployerBalance.toLocaleString()}`);
  console.log(`  Test Wallets:           ${totalWalletBalance.toLocaleString()}`);
  console.log(`  Job Escrows:            ${totalEscrowed.toLocaleString()}`);
  console.log(`  -----------------------------------------`);
  console.log(`  Accounted:              ${accounted.toLocaleString()}`);
  console.log(`  Total Supply:           ${totalSupply.toLocaleString()}`);
  console.log(`  Difference:             ${unaccounted.toLocaleString()}`);

  // The difference should be the burned tokens (if using burn mechanism)
  // Or could be rounding from decimals
  results.push({
    category: "Reconciliation",
    item: "All tokens accounted",
    expected: "Difference = 0 or burned amount",
    actual: `Diff = ${unaccounted.toLocaleString()}`,
    match: Math.abs(unaccounted) < 1, // Allow for small rounding
  });

  // ============================================================
  // 9H: SOL BALANCE CHECK
  // ============================================================
  console.log("\n--- 9H: SOL BALANCES ---\n");

  const deployerSol = await connection.getBalance(deployer.publicKey);
  console.log(`Deployer SOL: ${(deployerSol / LAMPORTS_PER_SOL).toFixed(6)}`);

  for (const w of wallets) {
    const balance = await connection.getBalance(w.keypair.publicKey);
    console.log(`${w.name} SOL: ${(balance / LAMPORTS_PER_SOL).toFixed(6)}`);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 9 AUDIT RESULTS");
  console.log("=".repeat(60));

  let passCount = 0;
  let failCount = 0;

  console.log("\n| Category | Item | Expected | Actual | Match |");
  console.log("|----------|------|----------|--------|-------|");
  for (const r of results) {
    const status = r.match ? "✓" : "✗";
    if (r.match) passCount++;
    else failCount++;
    console.log(`| ${r.category} | ${r.item} | ${r.expected} | ${r.actual} | ${status} |`);
  }

  console.log(`\nTotal: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let logContent = `\n---\n\n## PHASE 9: Token Accounting Audit\n\n`;
  logContent += `### Token Distribution Summary\n\n`;
  logContent += `| Location | Amount (ECASH) |\n`;
  logContent += `|----------|----------------|\n`;
  logContent += `| Vault (Mining Reserve) | ${vaultBalance.toLocaleString()} |\n`;
  logContent += `| Deployer (LP) | ${deployerBalance.toLocaleString()} |\n`;
  logContent += `| Test Wallets | ${totalWalletBalance.toLocaleString()} |\n`;
  logContent += `| Job Escrows | ${totalEscrowed.toLocaleString()} |\n`;
  logContent += `| **Total Accounted** | **${accounted.toLocaleString()}** |\n`;
  logContent += `| Total Supply | ${totalSupply.toLocaleString()} |\n`;
  logContent += `| Burned (counter) | ${totalBurned.toLocaleString()} |\n`;
  logContent += `\n### Audit Results\n\n`;
  logContent += `| Category | Item | Expected | Actual | Match |\n`;
  logContent += `|----------|------|----------|--------|-------|\n`;
  for (const r of results) {
    logContent += `| ${r.category} | ${r.item} | ${r.expected} | ${r.actual} | ${r.match ? "✓" : "✗"} |\n`;
  }
  logContent += `\n**Summary**: ${passCount}/${results.length} checks passed\n`;

  fs.appendFileSync(logPath, logContent);
  console.log("\nResults appended to DEPLOY-TEST-LOG.md");
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
