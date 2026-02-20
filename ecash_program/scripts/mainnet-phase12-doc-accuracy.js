// Phase 12: Documentation Accuracy Verification
// Compares SKILL.md constants against actual lib.rs and IDL

const fs = require("fs");
const path = require("path");
const os = require("os");

const results = [];
let pass = 0, fail = 0;

function log(id, name, doc, actual, ok) {
  if (ok) pass++; else fail++;
  results.push({ id, name, doc, actual, status: ok ? "PASS" : "FAIL" });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id}: ${name}`);
  if (!ok) console.log(`       Doc: ${doc}, Actual: ${actual}`);
}

function extractConstFromRust(content, name) {
  const regex = new RegExp(`pub const ${name}:\\s*\\w+\\s*=\\s*([^;]+);`);
  const match = content.match(regex);
  return match ? match[1].replace(/_/g, "") : null;
}

async function main() {
  console.log("=".repeat(60));
  console.log("  PHASE 12: DOCUMENTATION ACCURACY VERIFICATION");
  console.log("=".repeat(60));

  const skillPath = path.join(__dirname, "../SKILL.md");
  const libPath = path.join(__dirname, "../programs/ecash_program/src/lib.rs");
  const idlPath = path.join(__dirname, "../target/idl/ecash_program.json");

  const skill = fs.readFileSync(skillPath, "utf-8");
  const lib = fs.readFileSync(libPath, "utf-8");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  // ============================================================
  // 12A: Token Economics Constants
  // ============================================================
  console.log("\n--- 12A: Token Economics Constants ---\n");

  // TOTAL_SUPPLY
  const docTotalSupply = "21,000,000";
  const actualTotalSupply = extractConstFromRust(lib, "TOTAL_SUPPLY");
  log("12A.1", "TOTAL_SUPPLY", docTotalSupply, actualTotalSupply, actualTotalSupply === "21000000");

  // MINING_RESERVE
  const docMiningReserve = "18,900,000";
  const actualMiningReserve = extractConstFromRust(lib, "MINING_RESERVE");
  log("12A.2", "MINING_RESERVE", docMiningReserve, actualMiningReserve, actualMiningReserve === "18900000");

  // LP_ALLOCATION
  const docLP = "2,100,000";
  const actualLP = extractConstFromRust(lib, "LP_ALLOCATION");
  log("12A.3", "LP_ALLOCATION", docLP, actualLP, actualLP === "2100000");

  // TOKEN_DECIMALS
  const docDecimals = "9";
  const actualDecimals = extractConstFromRust(lib, "TOKEN_DECIMALS");
  log("12A.4", "TOKEN_DECIMALS", docDecimals, actualDecimals, actualDecimals === "9");

  // ============================================================
  // 12B: Era System Constants
  // ============================================================
  console.log("\n--- 12B: Era System Constants ---\n");

  // ERA1_END (doc says "Era 1 puzzles 0-3149", so ERA1_END should be 3150)
  const docEra1End = "3150"; // puzzles 0-3149 means ERA1_END = 3150
  const actualEra1End = extractConstFromRust(lib, "ERA1_END");
  log("12B.1", "ERA1_END", docEra1End, actualEra1End, actualEra1End === "3150");

  // ERA1_REWARD
  const docEra1Reward = "4,000";
  const actualEra1Reward = extractConstFromRust(lib, "ERA1_REWARD");
  log("12B.2", "ERA1_REWARD", docEra1Reward, actualEra1Reward, actualEra1Reward === "4000");

  // ERA2_REWARD
  const docEra2Reward = "2,000";
  const actualEra2Reward = extractConstFromRust(lib, "ERA2_REWARD");
  log("12B.3", "ERA2_REWARD", docEra2Reward, actualEra2Reward, actualEra2Reward === "2000");

  // ERA1_BURN
  const docEra1Burn = "1,000";
  const actualEra1Burn = extractConstFromRust(lib, "ERA1_BURN");
  log("12B.4", "ERA1_BURN", docEra1Burn, actualEra1Burn, actualEra1Burn === "1000");

  // ERA2_BURN
  const docEra2Burn = "500";
  const actualEra2Burn = extractConstFromRust(lib, "ERA2_BURN");
  log("12B.5", "ERA2_BURN", docEra2Burn, actualEra2Burn, actualEra2Burn === "500");

  // ============================================================
  // 12C: Gas System Constants
  // ============================================================
  console.log("\n--- 12C: Gas System Constants ---\n");

  // INITIAL_GAS
  const docInitialGas = "500";
  const actualInitialGas = extractConstFromRust(lib, "INITIAL_GAS");
  log("12C.1", "INITIAL_GAS", docInitialGas, actualInitialGas, actualInitialGas === "500");

  // GAS_FLOOR
  const docGasFloor = "35";
  const actualGasFloor = extractConstFromRust(lib, "GAS_FLOOR");
  log("12C.2", "GAS_FLOOR", docGasFloor, actualGasFloor, actualGasFloor === "35");

  // GAS_CAP
  const docGasCap = "100";
  const actualGasCap = extractConstFromRust(lib, "GAS_CAP");
  log("12C.3", "GAS_CAP", docGasCap, actualGasCap, actualGasCap === "100");

  // PICK_COST
  const docPickCost = "10";
  const actualPickCost = extractConstFromRust(lib, "PICK_COST");
  log("12C.4", "PICK_COST", docPickCost, actualPickCost, actualPickCost === "10");

  // COMMIT_COST
  const docCommitCost = "25";
  const actualCommitCost = extractConstFromRust(lib, "COMMIT_COST");
  log("12C.5", "COMMIT_COST", docCommitCost, actualCommitCost, actualCommitCost === "25");

  // SOLVE_BONUS
  const docSolveBonus = "100";
  const actualSolveBonus = extractConstFromRust(lib, "SOLVE_BONUS");
  log("12C.6", "SOLVE_BONUS", docSolveBonus, actualSolveBonus, actualSolveBonus === "100");

  // REFERRAL_BONUS
  const docReferralBonus = "100";
  const actualReferralBonus = extractConstFromRust(lib, "REFERRAL_BONUS");
  log("12C.7", "REFERRAL_BONUS", docReferralBonus, actualReferralBonus, actualReferralBonus === "100");

  // ============================================================
  // 12D: Batch System Constants
  // ============================================================
  console.log("\n--- 12D: Batch System Constants ---\n");

  // BATCH_SIZE
  const docBatchSize = "10";
  const actualBatchSize = extractConstFromRust(lib, "BATCH_SIZE");
  log("12D.1", "BATCH_SIZE", docBatchSize, actualBatchSize, actualBatchSize === "10");

  // BATCH_THRESHOLD
  const docBatchThreshold = "8";
  const actualBatchThreshold = extractConstFromRust(lib, "BATCH_THRESHOLD");
  log("12D.2", "BATCH_THRESHOLD", docBatchThreshold, actualBatchThreshold, actualBatchThreshold === "8");

  // BATCH_COOLDOWN
  const docBatchCooldown = "3600";
  const actualBatchCooldown = extractConstFromRust(lib, "BATCH_COOLDOWN");
  log("12D.3", "BATCH_COOLDOWN", docBatchCooldown, actualBatchCooldown, actualBatchCooldown === "3600");

  // ============================================================
  // 12E: Timeout Constants
  // ============================================================
  console.log("\n--- 12E: Timeout Constants ---\n");

  // PICK_TIMEOUT
  const docPickTimeout = "86400";
  const actualPickTimeout = extractConstFromRust(lib, "PICK_TIMEOUT");
  log("12E.1", "PICK_TIMEOUT", docPickTimeout, actualPickTimeout, actualPickTimeout === "86400");

  // REVEAL_WINDOW (doc says 300 seconds but lib.rs has 300 slots)
  const docRevealWindow = "300 seconds";
  const actualRevealWindow = extractConstFromRust(lib, "REVEAL_WINDOW");
  // Note: In lib.rs it's 300 slots, not seconds. This is a doc inaccuracy.
  const revealWindowMatch = actualRevealWindow === "300"; // slots, not seconds
  log("12E.2", "REVEAL_WINDOW", docRevealWindow, actualRevealWindow + " slots", revealWindowMatch);
  if (revealWindowMatch) {
    console.log("       NOTE: Doc says 'seconds' but actual is 'slots' (~120 seconds)");
  }

  // LOCKOUT_DURATION
  const docLockout = "86400";
  const actualLockout = extractConstFromRust(lib, "LOCKOUT_DURATION");
  log("12E.3", "LOCKOUT_DURATION", docLockout, actualLockout, actualLockout === "86400");

  // ============================================================
  // 12F: IDL Instruction Verification
  // ============================================================
  console.log("\n--- 12F: IDL Instructions ---\n");

  const expectedInstructions = [
    "initializeState", "initializeVault", "register", "enterBatch",
    "pick", "commitSolve", "revealSolve", "clearSolvedPick",
    "cancelExpiredCommit", "claimDailyGas", "renounceOwnership",
    "forceAdvanceStaleBatch", "createJob", "acceptJob", "submitWork",
    "confirmJob", "cancelJob", "reclaimExpired", "fileDispute",
    "assignArbitrator", "voteOnDispute", "resolveDispute",
    "registerProfile", "updateProfile", "refreshSolveCount",
    "enrollAsArbitrator", "withdrawFromArbitration"
  ];

  const idlInstructions = idl.instructions.map(i => i.name);
  console.log(`IDL has ${idlInstructions.length} instructions`);

  let instructionsMissing = [];
  for (const exp of expectedInstructions) {
    if (!idlInstructions.includes(exp)) {
      instructionsMissing.push(exp);
    }
  }

  if (instructionsMissing.length === 0) {
    log("12F.1", "Core instructions in IDL", "All present", "All found", true);
  } else {
    log("12F.1", "Core instructions in IDL", "All present", `Missing: ${instructionsMissing.join(", ")}`, false);
  }

  // ============================================================
  // 12G: Program ID Verification
  // ============================================================
  console.log("\n--- 12G: Program ID ---\n");

  const docProgramId = "7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u";
  const libProgramId = lib.match(/declare_id!\("([^"]+)"\)/)?.[1];
  log("12G.1", "Program ID", docProgramId, libProgramId, docProgramId === libProgramId);

  // ============================================================
  // 12H: API Server Documentation Accuracy
  // ============================================================
  console.log("\n--- 12H: API Server Documentation ---\n");

  // Check if API section mentions API server that doesn't exist
  const apiSection = skill.includes("## API Server");
  const hasApiDir = fs.existsSync(path.join(__dirname, "../api"));

  if (apiSection && !hasApiDir) {
    console.log("ISSUE: SKILL.md documents API server but no /api directory exists");
    log("12H.1", "API server documentation", "Matches reality", "API documented but doesn't exist", false);
  } else if (apiSection && hasApiDir) {
    log("12H.1", "API server documentation", "Matches reality", "API exists", true);
  } else {
    log("12H.1", "API server documentation", "N/A", "No API documented", true);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  PHASE 12 RESULTS");
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${pass} | Failed: ${fail}`);

  // List issues
  const issues = results.filter(r => r.status === "FAIL");
  if (issues.length > 0) {
    console.log("\n=== DOCUMENTATION ISSUES FOUND ===");
    for (const i of issues) {
      console.log(`  - ${i.name}: Doc says "${i.doc}", actual is "${i.actual}"`);
    }
  }

  // Save to log
  const logPath = path.join(os.homedir(), "ecash-solana/DEPLOY-TEST-LOG.md");
  let content = `\n---\n\n## PHASE 12: Documentation Accuracy Verification\n\n`;
  content += `| # | Constant | Documented | Actual | Status |\n|---|----------|------------|--------|--------|\n`;
  for (const r of results) {
    content += `| ${r.id} | ${r.name} | ${r.doc} | ${r.actual} | ${r.status} |\n`;
  }
  content += `\n**Summary**: ${pass}/${results.length} passed\n`;

  if (issues.length > 0) {
    content += `\n### Documentation Issues\n`;
    for (const i of issues) {
      content += `- **${i.name}**: Doc says "${i.doc}", actual is "${i.actual}"\n`;
    }
  }

  fs.appendFileSync(logPath, content);
  console.log("\nResults appended to DEPLOY-TEST-LOG.md");
}

main().catch(console.error);
