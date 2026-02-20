// Debug GlobalState raw bytes
const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

const GLOBAL_STATE = new PublicKey("ELXyB21ZTJiQUHf3pu4W95AiYJ14EDByCqX2JzPZtZqS");

async function main() {
  console.log("Debugging GlobalState raw bytes...\n");

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const gsInfo = await conn.getAccountInfo(GLOBAL_STATE);

  console.log("Account length:", gsInfo.data.length, "bytes");

  // Calculate offsets after 8-byte discriminator
  // authority: pubkey (32) offset 8
  // mint: pubkey (32) offset 40
  // merkle_root: [u8; 32] (32) offset 72
  // total_solved: u64 (8) offset 104
  // current_batch: u64 (8) offset 112
  // batch_solve_count: u64 (8) offset 120
  // cooldown_end: i64 (8) offset 128
  // total_burned: u64 (8) offset 136
  // is_renounced: bool (1) offset 144
  // bump: u8 (1) offset 145
  // mint_bump: u8 (1) offset 146
  // vault_bump: u8 (1) offset 147
  // total_jobs_created: u64 (8) offset 148
  // total_jobs_completed: u64 (8) offset 156
  // total_disputes: u64 (8) offset 164
  // total_escrow_burned: u64 (8) offset 172
  // next_job_id: u64 (8) offset 180
  // total_agents_registered: u64 (8) offset 188
  // total_arbitrators: u64 (8) offset 196

  console.log("Reading fields:");
  console.log("  discriminator:", Array.from(gsInfo.data.slice(0, 8)));
  console.log("  total_solved:", gsInfo.data.readBigUInt64LE(104).toString());
  console.log("  current_batch:", gsInfo.data.readBigUInt64LE(112).toString());
  console.log("  batch_solve_count:", gsInfo.data.readBigUInt64LE(120).toString());
  console.log("  cooldown_end:", gsInfo.data.readBigInt64LE(128).toString());
  console.log("  total_burned:", gsInfo.data.readBigUInt64LE(136).toString());
  console.log("  is_renounced:", gsInfo.data[144] !== 0);
  console.log("  bump:", gsInfo.data[145]);
  console.log("  mint_bump:", gsInfo.data[146]);
  console.log("  vault_bump:", gsInfo.data[147]);
  console.log("  total_jobs_created:", gsInfo.data.readBigUInt64LE(148).toString());
  console.log("  total_jobs_completed:", gsInfo.data.readBigUInt64LE(156).toString());
  console.log("  total_disputes:", gsInfo.data.readBigUInt64LE(164).toString());
  console.log("  total_escrow_burned:", gsInfo.data.readBigUInt64LE(172).toString());
  console.log("  next_job_id:", gsInfo.data.readBigUInt64LE(180).toString());
  console.log("  total_agents_registered:", gsInfo.data.readBigUInt64LE(188).toString());
  console.log("  total_arbitrators:", gsInfo.data.readBigUInt64LE(196).toString());

  // Now use Anchor deserialization
  console.log("\n--- Using Anchor deserialize ---");
  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/ecash_program.json")));
  const PROGRAM_ID = new PublicKey("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");
  idl.address = PROGRAM_ID.toString();

  const provider = new anchor.AnchorProvider(conn, { publicKey: GLOBAL_STATE }, { commitment: "confirmed" });
  const prog = new anchor.Program(idl, provider);
  const gs = await prog.account.globalState.fetch(GLOBAL_STATE);

  console.log("  nextJobId (Anchor):", gs.nextJobId.toString());
  console.log("  totalJobsCreated:", gs.totalJobsCreated.toString());
}

main().catch(e => {
  console.error("Error:", e.message);
});
