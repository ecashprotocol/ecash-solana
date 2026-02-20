const {
  Connection,
  Keypair,
  PublicKey,
} = require("@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotent,
  transfer,
} = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const os = require("os");

const MINT = new PublicKey("2BoR8DuJMGaZfWCBoELSng8Wo6db4Yf9zMdfM1xvVnYR");
const AMOUNT = 1000n * 1000000000n; // 1000 ECASH with 9 decimals

async function main() {
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  // Load deployer
  const deployerPath = path.join(os.homedir(), "ecash-solana/deployer.json");
  const deployer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(deployerPath, "utf-8")))
  );

  const deployerAta = getAssociatedTokenAddressSync(MINT, deployer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  console.log("Deployer ATA:", deployerAta.toString());

  for (let i = 1; i <= 5; i++) {
    const walletPath = path.join(os.homedir(), `ecash-solana/wallet-${i}.json`);
    const wallet = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
    );

    console.log(`\nWallet ${i}: ${wallet.publicKey.toString()}`);

    // Create ATA for recipient if needed
    const recipientAta = await createAssociatedTokenAccountIdempotent(
      connection,
      deployer,
      MINT,
      wallet.publicKey,
      {},
      TOKEN_2022_PROGRAM_ID
    );
    console.log(`  ATA: ${recipientAta.toString()}`);

    // Transfer ECASH
    const sig = await transfer(
      connection,
      deployer,
      deployerAta,
      recipientAta,
      deployer,
      AMOUNT,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    console.log(`  Transfer TX: ${sig}`);
    console.log(`  Sent: 1000 ECASH`);
  }

  console.log("\n=== ECASH FUNDING COMPLETE ===");
}

main().catch(console.error);
