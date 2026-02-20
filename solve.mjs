#!/usr/bin/env node
/**
 * Ecash Protocol — Example Mining Script
 *
 * Usage: node solve.mjs <puzzle_id> <answer>
 *
 * This script demonstrates the full mining flow:
 * 1. Normalize answer
 * 2. Decrypt blob (verify answer offline)
 * 3. If correct, show next steps for on-chain claiming
 *
 * Prerequisites:
 *   npm install @coral-xyz/anchor @solana/web3.js @solana/spl-token scrypt-js js-sha3
 *
 * Full docs: skill/SKILL.md
 */

import crypto from 'crypto';

const API_URL = 'https://api.ecash.bot';

// Normalize answer
function normalize(answer) {
  return answer
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Decrypt blob
async function decryptBlob(puzzleId, answer) {
  const scryptPkg = await import('scrypt-js');
  const { scrypt } = scryptPkg.default || scryptPkg;

  const normalized = normalize(answer);
  const password = Buffer.from(normalized, 'utf-8');
  const salt = Buffer.from(`ecash-v3-${puzzleId}`, 'utf-8');

  console.log('   Deriving key with scrypt (N=131072, r=8, p=1)...');
  const keyArray = await scrypt(password, salt, 131072, 8, 1, 32);
  const key = Buffer.from(keyArray);

  const res = await fetch(`${API_URL}/puzzles/${puzzleId}`);
  const puzzle = await res.json();

  if (!puzzle.blob || !puzzle.nonce || !puzzle.tag) {
    throw new Error('Puzzle blob data not found');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(puzzle.nonce, 'hex')
  );
  decipher.setAuthTag(Buffer.from(puzzle.tag, 'hex'));

  let decrypted = decipher.update(Buffer.from(puzzle.blob, 'hex'), null, 'utf-8');
  decrypted += decipher.final('utf-8');

  return JSON.parse(decrypted);
}

// Main
const puzzleId = parseInt(process.argv[2]);
const answer = process.argv.slice(3).join(' ');

if (!puzzleId && puzzleId !== 0 || !answer) {
  console.log('Ecash Protocol — Mining Script\n');
  console.log('Usage: node solve.mjs <puzzle_id> <answer>');
  console.log('Example: node solve.mjs 42 "golden ratio spiral"');
  console.log('\nThis script verifies your answer offline using scrypt + AES-256-GCM.');
  console.log('If correct, it displays the salt and proof needed for on-chain claiming.');
  process.exit(1);
}

console.log(`\n━━━ Ecash Mining ━━━`);
console.log(`Puzzle: #${puzzleId}`);
console.log(`Answer: "${answer}"`);
console.log(`Normalized: "${normalize(answer)}"`);

console.log('\n1. Verifying answer offline (scrypt + AES-256-GCM)...');
try {
  const result = await decryptBlob(puzzleId, answer);

  console.log('\n   ✅ Answer is CORRECT!\n');
  console.log('━━━ Decrypted Data ━━━');
  console.log(`Salt: ${result.salt}`);
  console.log(`Proof: [${result.proof.length} merkle proof elements]`);

  console.log('\n━━━ Next Steps ━━━');
  console.log('To claim your reward on-chain, follow these steps:');
  console.log('');
  console.log('1. Register (if first time):');
  console.log('   program.methods.register(referrer).accounts({...}).rpc()');
  console.log('');
  console.log('2. Enter batch (burns ECASH):');
  console.log('   program.methods.enterBatch().accounts({...}).rpc()');
  console.log('');
  console.log('3. Pick this puzzle:');
  console.log(`   program.methods.pick(${puzzleId}).accounts({...}).rpc()`);
  console.log('');
  console.log('4. Commit your answer hash:');
  console.log('   const secret = crypto.randomBytes(32);');
  console.log('   const hash = keccak256(answer + salt + secret + signer);');
  console.log('   program.methods.commitSolve([...hash]).accounts({...}).rpc()');
  console.log('');
  console.log('5. Wait for next slot, then reveal:');
  console.log('   program.methods.revealSolve(answer, [...salt], [...secret], proof).accounts({...}).rpc()');
  console.log('');
  console.log('See skill/SKILL.md for complete code examples.');

} catch (e) {
  console.log('\n   ❌ Wrong answer (decryption failed)');
  console.log(`   Error: ${e.message}`);
  console.log('\n   Try a different guess.');
  process.exit(1);
}
