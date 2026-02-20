// Test claim_daily_gas for W2 miner
const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROGRAM_ID = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
const GLOBAL_STATE = new PublicKey("ELXyB21ZTJiQUHf3pu4W95AiYJ14EDByCqX2JzPZtZqS");
const W2_MINER_PDA = new PublicKey("97tVeCU4a4DymqJjjc2uXZ9hyGL8cr7TamFgRxFQR2hz");
const MINER_STATE_SEED = Buffer.from("miner_state");

const loadWallet = (n) => Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), `ecash-solana/${n}.json`))))
);

async function main() {
  console.log("Testing claim_daily_gas...\n");

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const w2 = loadWallet("wallet-2");

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  idl.address = PROGRAM_ID.toString();

  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(w2), { commitment: "confirmed" });
  const prog = new anchor.Program(idl, provider);

  // Verify W2 miner PDA matches
  const [computedMinerPda] = PublicKey.findProgramAddressSync(
    [MINER_STATE_SEED, w2.publicKey.toBuffer()],
    PROGRAM_ID
  );

  console.log("W2 public key:", w2.publicKey.toString());
  console.log("Computed miner PDA:", computedMinerPda.toString());
  console.log("Expected miner PDA:", W2_MINER_PDA.toString());
  console.log("Match:", computedMinerPda.equals(W2_MINER_PDA));

  // Read miner state before
  console.log("\n--- Miner State BEFORE ---");
  try {
    const minerState = await prog.account.minerState.fetch(W2_MINER_PDA);
    console.log("Gas balance:", minerState.gasBalance.toString());
    console.log("Last regen time:", new Date(minerState.lastRegenTime.toNumber() * 1000).toISOString());
    console.log("Solve count:", minerState.solveCount.toString());

    // Calculate days since last regen
    const now = Math.floor(Date.now() / 1000);
    const lastRegen = minerState.lastRegenTime.toNumber();
    const daysSinceRegen = Math.floor((now - lastRegen) / 86400);
    console.log("Days since last regen:", daysSinceRegen);

    if (daysSinceRegen < 1) {
      console.log("\n[INFO] Less than 1 day since last regen - gas claim may not add anything");
    }
  } catch (e) {
    console.log("[ERROR] Could not fetch miner state:", e.message);
    return;
  }

  // Try claim_daily_gas
  console.log("\n--- Calling claim_daily_gas ---");
  try {
    const tx = await prog.methods
      .claimDailyGas()
      .accounts({
        owner: w2.publicKey,
        minerState: W2_MINER_PDA,
        globalState: GLOBAL_STATE,
      })
      .rpc();

    await conn.confirmTransaction(tx, "confirmed");
    console.log("[OK] claim_daily_gas succeeded:", tx);

    // Read miner state after
    console.log("\n--- Miner State AFTER ---");
    const minerStateAfter = await prog.account.minerState.fetch(W2_MINER_PDA);
    console.log("Gas balance:", minerStateAfter.gasBalance.toString());
    console.log("Last regen time:", new Date(minerStateAfter.lastRegenTime.toNumber() * 1000).toISOString());
  } catch (e) {
    console.log("[ERROR] claim_daily_gas failed:", e.message);
    if (e.logs) {
      console.log("\nLogs:");
      e.logs.forEach(l => console.log("  ", l));
    }
  }
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
