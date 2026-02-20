// Check batch cooldown status
const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

const PROGRAM_ID = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
const GLOBAL_STATE = new PublicKey("ELXyB21ZTJiQUHf3pu4W95AiYJ14EDByCqX2JzPZtZqS");

async function main() {
  console.log("Checking batch status...\n");

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  idl.address = PROGRAM_ID.toString();

  const provider = new anchor.AnchorProvider(conn, { publicKey: GLOBAL_STATE }, { commitment: "confirmed" });
  const prog = new anchor.Program(idl, provider);

  const gs = await prog.account.globalState.fetch(GLOBAL_STATE);

  const now = Math.floor(Date.now() / 1000);
  const cooldownEnd = gs.cooldownEnd.toNumber();

  console.log("Current Batch:", gs.currentBatch.toString());
  console.log("Batch Solve Count:", gs.batchSolveCount.toString());
  console.log("Total Solved:", gs.totalSolved.toString());
  console.log("Total Burned:", Number(gs.totalBurned) / 1e9, "ECASH");
  console.log("Next Job ID:", gs.nextJobId.toString());
  console.log("Total Jobs Created:", gs.totalJobsCreated.toString());
  console.log("Total Agents Registered:", gs.totalAgentsRegistered.toString());
  console.log("Total Arbitrators:", gs.totalArbitrators.toString());

  console.log("\n--- Cooldown Status ---");
  console.log("Cooldown End:", new Date(cooldownEnd * 1000).toISOString());
  console.log("Current Time:", new Date(now * 1000).toISOString());

  if (cooldownEnd > now) {
    const remaining = cooldownEnd - now;
    const hours = Math.floor(remaining / 3600);
    const mins = Math.floor((remaining % 3600) / 60);
    console.log(`[ACTIVE] Cooldown ends in ${hours}h ${mins}m`);
  } else {
    const expired = now - cooldownEnd;
    const hours = Math.floor(expired / 3600);
    const mins = Math.floor((expired % 3600) / 60);
    console.log(`[EXPIRED] Cooldown ended ${hours}h ${mins}m ago`);
    console.log("\nReady for phase17-continue.js!");
  }
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
