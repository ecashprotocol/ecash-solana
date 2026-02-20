/**
 * Ecash Protocol — Solana Mining SDK
 * Full documentation: https://github.com/ecashprotocol/ecash-solana/blob/main/skill/SKILL.md
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import crypto from 'crypto';

// ============ Constants ============
export const PROGRAM_ID = new PublicKey('w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY');
export const MINT = new PublicKey('7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7');
export const API_URL = 'https://api.ecash.bot';

// ============ PDA Derivation ============
export function getGlobalStatePda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('global_state')],
    PROGRAM_ID
  )[0];
}

export function getMinerStatePda(owner) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('miner_state'), owner.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function getVaultPda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault')],
    PROGRAM_ID
  )[0];
}

export function getPuzzleSolvedPda(puzzleId) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(puzzleId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from('puzzle_solved'), buf],
    PROGRAM_ID
  )[0];
}

// ============ Answer Normalization ============
export function normalize(answer) {
  return answer
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============ Blob Decryption ============
export async function decryptBlob(puzzleId, answer) {
  // Dynamically import scrypt-js
  const scryptPkg = await import('scrypt-js');
  const { scrypt } = scryptPkg.default || scryptPkg;

  const normalized = normalize(answer);
  const password = Buffer.from(normalized, 'utf-8');
  const salt = Buffer.from(`ecash-v3-${puzzleId}`, 'utf-8');

  // scrypt: N=131072, r=8, p=1, keyLen=32
  const keyArray = await scrypt(password, salt, 131072, 8, 1, 32);
  const key = Buffer.from(keyArray);

  // Fetch puzzle blob from API
  const res = await fetch(`${API_URL}/puzzles/${puzzleId}`);
  const puzzle = await res.json();

  if (!puzzle.blob || !puzzle.nonce || !puzzle.tag) {
    throw new Error('Puzzle blob data not found');
  }

  // AES-256-GCM decrypt
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(puzzle.nonce, 'hex')
  );
  decipher.setAuthTag(Buffer.from(puzzle.tag, 'hex'));

  let decrypted = decipher.update(Buffer.from(puzzle.blob, 'hex'), null, 'utf-8');
  decrypted += decipher.final('utf-8');

  return JSON.parse(decrypted); // { salt, proof }
}

// ============ Commit Hash ============
export function computeCommitHash(answer, saltHex, secretHex, signerPubkey) {
  // Import keccak synchronously
  const { keccak_256 } = require('js-sha3');

  const normalized = normalize(answer);
  const answerBytes = Buffer.from(normalized, 'utf-8');
  const saltBytes = Buffer.from(saltHex.replace(/^0x/, ''), 'hex');
  const secretBytes = Buffer.from(secretHex.replace(/^0x/, ''), 'hex');
  const signerBytes = signerPubkey.toBuffer();

  const combined = Buffer.concat([answerBytes, saltBytes, secretBytes, signerBytes]);
  return Buffer.from(keccak_256.arrayBuffer(combined));
}

// ============ API Helpers ============
export async function getUnsolvedPuzzles() {
  const res = await fetch(`${API_URL}/puzzles`);
  const puzzles = await res.json();
  return puzzles.filter(p => !p.solved);
}

export async function getPuzzle(puzzleId) {
  const res = await fetch(`${API_URL}/puzzles/${puzzleId}`);
  return res.json();
}

export async function getStats() {
  const res = await fetch(`${API_URL}/stats`);
  return res.json();
}

export async function getLeaderboard() {
  const res = await fetch(`${API_URL}/leaderboard`);
  return res.json();
}

export async function getActivity(limit = 10) {
  const res = await fetch(`${API_URL}/activity?limit=${limit}`);
  return res.json();
}

export async function getContract() {
  const res = await fetch(`${API_URL}/contract`);
  return res.json();
}

// ============ Wallet Helpers ============
export function generateWallet() {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: Array.from(keypair.secretKey),
    keypair
  };
}

export function walletFromSecretKey(secretKeyArray) {
  const keypair = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
  return {
    publicKey: keypair.publicKey.toBase58(),
    keypair
  };
}

// ============ Token Account ============
export function getTokenAccount(owner) {
  return getAssociatedTokenAddressSync(
    MINT,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID
  );
}
