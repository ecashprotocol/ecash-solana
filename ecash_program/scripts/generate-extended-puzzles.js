// Generate extended puzzle set (puzzles 0-29 for batches 0-2)
// This creates enough puzzles for 3 batches worth of testing

const { keccak256 } = require('js-sha3');
const { BN } = require('@coral-xyz/anchor');

const keccak = (input) => Buffer.from(keccak256.arrayBuffer(input));
const normalizeAnswer = (a) => a.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, ' ');

function abiEncode(puzzleId, answer, salt) {
  const id = Buffer.alloc(32); new BN(puzzleId).toArrayLike(Buffer, 'be', 8).copy(id, 24);
  const off = Buffer.alloc(32); off[31] = 0x60;
  const str = Buffer.from(answer);
  const len = Buffer.alloc(32); new BN(str.length).toArrayLike(Buffer, 'be', 8).copy(len, 24);
  const pad = Buffer.alloc(Math.max(Math.ceil(str.length / 32) * 32, 32)); str.copy(pad);
  return Buffer.concat([id, off, salt, len, pad]);
}

const merkleLeaf = (id, ans, salt) => keccak(keccak(abiEncode(id, ans, salt)));
const sortHash = (a, b) => a.compare(b) <= 0 ? keccak(Buffer.concat([a, b])) : keccak(Buffer.concat([b, a]));

// Extended puzzle set - 30 puzzles for 3 batches
const puzzles = [
  // Batch 0 (existing)
  { id: 0, ans: 'the rosetta stone', salt: Buffer.alloc(32, 1) },
  { id: 1, ans: 'fibonacci sequence', salt: Buffer.alloc(32, 2) },
  { id: 2, ans: 'golden ratio', salt: Buffer.alloc(32, 3) },
  { id: 3, ans: 'prime number', salt: Buffer.alloc(32, 4) },
  { id: 4, ans: 'euler identity', salt: Buffer.alloc(32, 5) },
  { id: 5, ans: 'pythagorean theorem', salt: Buffer.alloc(32, 6) },
  { id: 6, ans: 'archimedes principle', salt: Buffer.alloc(32, 7) },
  { id: 7, ans: 'newtons laws', salt: Buffer.alloc(32, 8) },
  { id: 8, ans: 'theory of relativity', salt: Buffer.alloc(32, 9) },
  { id: 9, ans: 'quantum mechanics', salt: Buffer.alloc(32, 10) },
  // Batch 1 (NEW)
  { id: 10, ans: 'planck constant', salt: Buffer.alloc(32, 11) },
  { id: 11, ans: 'heisenberg uncertainty', salt: Buffer.alloc(32, 12) },
  { id: 12, ans: 'schrodinger equation', salt: Buffer.alloc(32, 13) },
  { id: 13, ans: 'maxwell equations', salt: Buffer.alloc(32, 14) },
  { id: 14, ans: 'fourier transform', salt: Buffer.alloc(32, 15) },
  { id: 15, ans: 'taylor series', salt: Buffer.alloc(32, 16) },
  { id: 16, ans: 'laplace transform', salt: Buffer.alloc(32, 17) },
  { id: 17, ans: 'riemann hypothesis', salt: Buffer.alloc(32, 18) },
  { id: 18, ans: 'fermats last theorem', salt: Buffer.alloc(32, 19) },
  { id: 19, ans: 'godel incompleteness', salt: Buffer.alloc(32, 20) },
  // Batch 2 (NEW)
  { id: 20, ans: 'turing machine', salt: Buffer.alloc(32, 21) },
  { id: 21, ans: 'boolean algebra', salt: Buffer.alloc(32, 22) },
  { id: 22, ans: 'lambda calculus', salt: Buffer.alloc(32, 23) },
  { id: 23, ans: 'church encoding', salt: Buffer.alloc(32, 24) },
  { id: 24, ans: 'halting problem', salt: Buffer.alloc(32, 25) },
  { id: 25, ans: 'np completeness', salt: Buffer.alloc(32, 26) },
  { id: 26, ans: 'dijkstra algorithm', salt: Buffer.alloc(32, 27) },
  { id: 27, ans: 'bellman ford', salt: Buffer.alloc(32, 28) },
  { id: 28, ans: 'dynamic programming', salt: Buffer.alloc(32, 29) },
  { id: 29, ans: 'divide and conquer', salt: Buffer.alloc(32, 30) },
];

// Build leaves
const leaves = puzzles.map(p => merkleLeaf(p.id, normalizeAnswer(p.ans), p.salt));

// Build Merkle tree and proofs
function buildTree(leaves) {
  let lvl = [...leaves];
  const proofs = leaves.map(() => []);
  const pos = leaves.map((_, i) => i);

  while (lvl.length > 1) {
    const next = [];
    for (let i = 0; i < lvl.length; i += 2) {
      next.push(sortHash(lvl[i], lvl[i + 1] || lvl[i]));
    }
    for (let j = 0; j < leaves.length; j++) {
      const sib = pos[j] % 2 === 0 ? pos[j] + 1 : pos[j] - 1;
      if (sib < lvl.length) proofs[j].push(lvl[sib]);
      pos[j] = Math.floor(pos[j] / 2);
    }
    lvl = next;
  }

  return { root: lvl[0], proofs };
}

const { root, proofs } = buildTree(leaves);

console.log('='.repeat(60));
console.log('EXTENDED PUZZLE SET - 30 PUZZLES (3 BATCHES)');
console.log('='.repeat(60));
console.log('');
console.log('NEW MERKLE ROOT (for lib.rs):');
console.log('');
console.log('pub const MERKLE_ROOT: [u8; 32] = [');
const bytes = Array.from(root);
for (let i = 0; i < 32; i += 16) {
  const line = bytes.slice(i, i + 16).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ');
  console.log('    ' + line + ',');
}
console.log('];');
console.log('');
console.log('Root hex:', root.toString('hex'));
console.log('');

// Output puzzle data for scripts
console.log('PUZZLE DATA FOR SCRIPTS:');
console.log('');
console.log('const puzzles = [');
for (let i = 0; i < puzzles.length; i++) {
  const p = puzzles[i];
  const proofStr = proofs[i].map(h => 'Buffer.from("' + h.toString('hex') + '", "hex")').join(', ');
  console.log(`  { id: ${p.id}, ans: "${p.ans}", salt: Buffer.alloc(32, ${p.salt[0]}), proof: [${proofStr}] },`);
}
console.log('];');
console.log('');

// Verify batch 0 proofs still work
console.log('VERIFICATION:');
console.log('');

function verifyProof(proof, root, leaf) {
  let hash = leaf;
  for (const sib of proof) {
    hash = sortHash(hash, sib);
  }
  return hash.equals(root);
}

console.log('Batch 0 puzzles (0-9):');
for (let i = 0; i < 10; i++) {
  const leaf = leaves[i];
  const valid = verifyProof(proofs[i], root, leaf);
  console.log(`  Puzzle ${i}: ${valid ? '✓' : '✗'}`);
}

console.log('');
console.log('Batch 1 puzzles (10-19):');
for (let i = 10; i < 20; i++) {
  const leaf = leaves[i];
  const valid = verifyProof(proofs[i], root, leaf);
  console.log(`  Puzzle ${i}: ${valid ? '✓' : '✗'}`);
}

console.log('');
console.log('Batch 2 puzzles (20-29):');
for (let i = 20; i < 30; i++) {
  const leaf = leaves[i];
  const valid = verifyProof(proofs[i], root, leaf);
  console.log(`  Puzzle ${i}: ${valid ? '✓' : '✗'}`);
}
