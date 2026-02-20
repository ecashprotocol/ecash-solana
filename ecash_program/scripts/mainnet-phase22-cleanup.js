const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount, createCloseAccountInstruction } = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const os = require("os");

const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");

async function loadWallet(name) {
  const walletPath = path.join(os.homedir(), `ecash-solana/${name}.json`);
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
}

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 22: CLEANUP + SOL RECOVERY");
  console.log("=".repeat(60));

  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  const deployer = await loadWallet("deployer");
  const wallet1 = await loadWallet("wallet-1");
  const wallet2 = await loadWallet("wallet-2");
  const wallet3 = await loadWallet("wallet-3");

  const wallets = [
    { name: "wallet-1", keypair: wallet1 },
    { name: "wallet-2", keypair: wallet2 },
    { name: "wallet-3", keypair: wallet3 },
  ];

  // Try to load wallet-4 and wallet-5 if they exist
  try {
    const wallet4 = await loadWallet("wallet-4");
    wallets.push({ name: "wallet-4", keypair: wallet4 });
  } catch (e) {
    console.log("wallet-4 not found, skipping");
  }
  try {
    const wallet5 = await loadWallet("wallet-5");
    wallets.push({ name: "wallet-5", keypair: wallet5 });
  } catch (e) {
    console.log("wallet-5 not found, skipping");
  }

  let totalRecovered = 0;
  const results = [];

  // ============================================================
  // STEP 1: Check initial balances
  // ============================================================
  console.log("\n--- Initial Balances ---\n");

  const deployerInitialBalance = await connection.getBalance(deployer.publicKey);
  console.log(`Deployer: ${deployerInitialBalance / LAMPORTS_PER_SOL} SOL`);

  for (const w of wallets) {
    const balance = await connection.getBalance(w.keypair.publicKey);
    console.log(`${w.name}: ${balance / LAMPORTS_PER_SOL} SOL`);
  }

  // ============================================================
  // STEP 2: Close SPL Token Accounts (if empty or recover ECASH)
  // ============================================================
  console.log("\n--- Closing SPL Token Accounts ---\n");

  for (const w of wallets) {
    try {
      const ata = getAssociatedTokenAddressSync(MINT, w.keypair.publicKey, false, TOKEN_2022_PROGRAM_ID);

      // Check if account exists and its balance
      try {
        const account = await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
        const tokenBalance = Number(account.amount) / 1e9;
        console.log(`${w.name} ATA: ${tokenBalance} ECASH`);

        if (tokenBalance === 0) {
          // Can close empty account
          const tx = new Transaction().add(
            createCloseAccountInstruction(
              ata,
              deployer.publicKey, // Destination for rent
              w.keypair.publicKey, // Owner
              [],
              TOKEN_2022_PROGRAM_ID
            )
          );

          const sig = await sendAndConfirmTransaction(connection, tx, [w.keypair]);
          const rentRecovered = 0.002; // Approximate rent
          totalRecovered += rentRecovered;
          console.log(`[PASS] Closed ${w.name} ATA, recovered ~${rentRecovered} SOL: ${sig}`);
          results.push({ action: `Close ${w.name} ATA`, status: "PASS", tx: sig });
        } else {
          console.log(`[SKIP] ${w.name} ATA has ${tokenBalance} ECASH, keeping open`);
          results.push({ action: `Close ${w.name} ATA`, status: "SKIP", reason: "Has balance" });
        }
      } catch (e) {
        if (e.message.includes("could not find account")) {
          console.log(`[SKIP] ${w.name} ATA does not exist`);
        } else {
          console.log(`[INFO] ${w.name} ATA: ${e.message.slice(0, 50)}`);
        }
      }
    } catch (e) {
      console.log(`[ERROR] ${w.name}: ${e.message.slice(0, 50)}`);
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }

  // ============================================================
  // STEP 3: Sweep SOL from test wallets to deployer
  // ============================================================
  console.log("\n--- Sweeping SOL to Deployer ---\n");

  for (const w of wallets) {
    try {
      const balance = await connection.getBalance(w.keypair.publicKey);

      // Keep 0.001 SOL for potential future use, sweep the rest
      const minRent = 0.001 * LAMPORTS_PER_SOL;
      const txFee = 5000; // 0.000005 SOL
      const sweepAmount = balance - minRent - txFee;

      if (sweepAmount > 0) {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: w.keypair.publicKey,
            toPubkey: deployer.publicKey,
            lamports: sweepAmount,
          })
        );

        const sig = await sendAndConfirmTransaction(connection, tx, [w.keypair]);
        const recoveredSol = sweepAmount / LAMPORTS_PER_SOL;
        totalRecovered += recoveredSol;
        console.log(`[PASS] Swept ${recoveredSol.toFixed(6)} SOL from ${w.name}: ${sig}`);
        results.push({ action: `Sweep ${w.name}`, status: "PASS", amount: recoveredSol, tx: sig });
      } else {
        console.log(`[SKIP] ${w.name} has insufficient balance to sweep`);
        results.push({ action: `Sweep ${w.name}`, status: "SKIP", reason: "Low balance" });
      }
    } catch (e) {
      console.log(`[ERROR] ${w.name}: ${e.message.slice(0, 50)}`);
      results.push({ action: `Sweep ${w.name}`, status: "FAIL", error: e.message.slice(0, 50) });
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }

  // ============================================================
  // STEP 4: Final Balances
  // ============================================================
  console.log("\n--- Final Balances ---\n");

  const deployerFinalBalance = await connection.getBalance(deployer.publicKey);
  console.log(`Deployer Final: ${deployerFinalBalance / LAMPORTS_PER_SOL} SOL`);

  for (const w of wallets) {
    const balance = await connection.getBalance(w.keypair.publicKey);
    console.log(`${w.name} Final: ${balance / LAMPORTS_PER_SOL} SOL`);
  }

  // ============================================================
  // STEP 5: Summary
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 22 SUMMARY");
  console.log("=".repeat(60));

  const netChange = (deployerFinalBalance - deployerInitialBalance) / LAMPORTS_PER_SOL;
  console.log(`\nDeployer balance change: ${netChange >= 0 ? '+' : ''}${netChange.toFixed(6)} SOL`);
  console.log(`Total recovered: ${totalRecovered.toFixed(6)} SOL`);

  // Calculate total SOL spent estimate
  // Program deployment ~0.7-1 SOL, test transactions ~0.001 each
  const programRent = 0.8; // Approximate
  const txFees = 0.05;     // Approximate for all tests
  const testFunding = 0.05; // Funds sent to test wallets
  console.log(`\nEstimated spending:`);
  console.log(`  Program rent: ~${programRent} SOL`);
  console.log(`  TX fees: ~${txFees} SOL`);
  console.log(`  Test funding: ~${testFunding} SOL`);
  console.log(`  Total estimated: ~${(programRent + txFees + testFunding).toFixed(3)} SOL`);

  // ============================================================
  // Append to log
  // ============================================================
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let logContent = `\n---\n\n## PHASE 22: Cleanup + SOL Recovery\n\n`;
  logContent += `### Actions\n\n`;
  logContent += `| Action | Status | Details |\n`;
  logContent += `|--------|--------|--------|\n`;
  for (const r of results) {
    const details = r.tx ? `TX: ${r.tx.slice(0, 20)}...` : (r.reason || r.error || "");
    logContent += `| ${r.action} | ${r.status} | ${details} |\n`;
  }
  logContent += `\n### Final Balances\n\n`;
  logContent += `- Deployer: ${(deployerFinalBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL\n`;
  for (const w of wallets) {
    const balance = await connection.getBalance(w.keypair.publicKey);
    logContent += `- ${w.name}: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL\n`;
  }
  logContent += `\n### Recovery Summary\n\n`;
  logContent += `- Total SOL recovered: ${totalRecovered.toFixed(6)} SOL\n`;
  logContent += `- Deployer balance change: ${netChange >= 0 ? '+' : ''}${netChange.toFixed(6)} SOL\n`;

  fs.appendFileSync(logPath, logContent);
  console.log("\nResults appended to DEPLOY-TEST-LOG.md");
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
