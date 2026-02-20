const crypto = require('crypto');
const fs = require('fs');

// Compute Anchor discriminator: sha256("global:<name>") first 8 bytes for instructions
// sha256("account:<TypeName>") first 8 bytes for accounts
function computeDiscriminator(prefix, name) {
  const hash = crypto.createHash('sha256').update(`${prefix}:${name}`).digest();
  return Array.from(hash.slice(0, 8));
}

// All instruction names from lib.rs (snake_case)
const instructions = [
  'initialize_state',
  'initialize_vault',
  'register',
  'enter_batch',
  'pick',
  'commit_solve',
  'reveal_solve',
  'clear_solved_pick',
  'cancel_expired_commit',
  'claim_daily_gas',
  'renounce_ownership',
  'force_advance_stale_batch',
  'create_job',
  'accept_job',
  'submit_work',
  'confirm_job',
  'cancel_job',
  'reclaim_expired',
  'file_dispute',
  'assign_arbitrator',
  'vote_on_dispute',
  'resolve_dispute',
  'register_profile',
  'update_profile',
  'refresh_solve_count',
  'enroll_as_arbitrator',
  'withdraw_from_arbitration'
];

// Account types (PascalCase)
const accounts = [
  'GlobalState',
  'MinerState',
  'PuzzleSolved',
  'Job',
  'Dispute',
  'AgentProfile',
  'ArbitratorStats'
];

console.log('=== INSTRUCTION DISCRIMINATORS ===');
const instructionDiscriminators = {};
for (const name of instructions) {
  const disc = computeDiscriminator('global', name);
  instructionDiscriminators[name] = disc;
  console.log(`${name}: [${disc.join(', ')}]`);
}

console.log('\n=== ACCOUNT DISCRIMINATORS ===');
const accountDiscriminators = {};
for (const name of accounts) {
  const disc = computeDiscriminator('account', name);
  accountDiscriminators[name] = disc;
  console.log(`${name}: [${disc.join(', ')}]`);
}

// Load and update IDL
const idlPath = './target/idl/ecash_program.json';
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

// Update instruction discriminators
console.log('\n=== UPDATING IDL INSTRUCTIONS ===');
for (const ix of idl.instructions) {
  const correctDisc = instructionDiscriminators[ix.name];
  if (correctDisc) {
    const oldDisc = ix.discriminator;
    const changed = JSON.stringify(oldDisc) !== JSON.stringify(correctDisc);
    if (changed) {
      console.log(`${ix.name}: [${oldDisc.join(', ')}] -> [${correctDisc.join(', ')}]`);
    } else {
      console.log(`${ix.name}: OK (unchanged)`);
    }
    ix.discriminator = correctDisc;
  } else {
    console.log(`WARNING: No discriminator for instruction: ${ix.name}`);
  }
}

// Update account discriminators
console.log('\n=== UPDATING IDL ACCOUNTS ===');
for (const acc of idl.accounts) {
  const correctDisc = accountDiscriminators[acc.name];
  if (correctDisc) {
    const oldDisc = acc.discriminator;
    const changed = JSON.stringify(oldDisc) !== JSON.stringify(correctDisc);
    if (changed) {
      console.log(`${acc.name}: [${oldDisc.join(', ')}] -> [${correctDisc.join(', ')}]`);
    } else {
      console.log(`${acc.name}: OK (unchanged)`);
    }
    acc.discriminator = correctDisc;
  } else {
    console.log(`WARNING: No discriminator for account: ${acc.name}`);
  }
}

// Write updated IDL
fs.writeFileSync(idlPath, JSON.stringify(idl, null, 2));
console.log('\n=== IDL UPDATED SUCCESSFULLY ===');
