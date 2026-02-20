# Ecash Solana Protocol - Complete Bot Guide

This document enables an AI/bot to fully understand, deploy, test, and operate the Ecash Solana protocol from scratch.

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Setup Environment](#setup-environment)
4. [Build & Deploy](#build--deploy)
5. [Run Tests](#run-tests)
6. [Program Instructions](#program-instructions)
7. [Puzzle Solving Flow](#puzzle-solving-flow)
8. [API Server](#api-server)
9. [SDK Usage](#sdk-usage)
10. [Constants Reference](#constants-reference)
11. [Error Codes](#error-codes)

---

## Overview

Ecash is a puzzle-solving mining protocol on Solana. Users solve puzzles to earn ECASH tokens. The protocol uses:
- **Commit-reveal pattern** to prevent front-running
- **Merkle proofs** to verify puzzle solutions
- **Batch system** to unlock puzzles progressively
- **Gas system** to rate-limit actions

**Key Metrics:**
- Total Supply: 21,000,000 ECASH
- Total Puzzles: 6,300
- Token Decimals: 9
- Token Standard: SPL Token-2022

---

## Architecture

### PDAs (Program Derived Addresses)

| Account | Seed | Purpose |
|---------|------|---------|
| GlobalState | `"global_state"` | Protocol state (solved count, current batch) |
| Mint | `"ecash_mint"` | Token mint account |
| Vault | `"vault"` | Mining reserve (18.9M tokens) |
| MinerState | `"miner_state" + pubkey` | Per-miner state |
| PuzzleSolved | `"puzzle_solved" + puzzle_id` | Marks solved puzzles |

### Token Distribution
- Mining Reserve (Vault): 18,900,000 ECASH (90%)
- LP Allocation (Authority): 2,100,000 ECASH (10%)

---

## Setup Environment

### Prerequisites
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli

# Install Node.js dependencies
npm install
```

### Directory Structure
```
ecash_program/
├── programs/ecash_program/src/lib.rs  # Main program
├── tests/
│   ├── ecash.test.ts                   # Core tests (57)
│   └── stress.test.ts                  # Stress tests (71)
├── api/                                # API server
├── sdk/                                # TypeScript SDK
├── target/idl/ecash_program.json       # IDL
└── Anchor.toml                         # Config
```

---

## Build & Deploy

### Build Program
```bash
anchor build --no-idl
```

### Start Local Validator
```bash
solana-test-validator --reset
```

### Deploy
```bash
anchor deploy
```

### Get Program ID
```bash
anchor keys list
# Output: ecash_program: 7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u
```

---

## Run Tests

### Run All Tests
```bash
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npm test
```

### Run Specific Test File
```bash
npx ts-mocha -p ./tsconfig.json -t 300000 tests/stress.test.ts
```

### Expected Results
- Total: 128 tests passing
- ecash.test.ts: 57 tests
- stress.test.ts: 71 tests (3 intentionally skipped)

---

## Program Instructions

### 1. initialize_state
Creates GlobalState and Mint accounts.

**Accounts:**
- `authority` (signer, mut): Deployer
- `global_state` (init): PDA with seed `"global_state"`
- `mint` (init): PDA with seed `"ecash_mint"`
- `token_program`: Token-2022 program
- `system_program`: System program

### 2. initialize_vault
Mints tokens to vault and authority.

**Accounts:**
- `authority` (signer, mut)
- `global_state` (mut)
- `mint` (mut)
- `vault` (init): PDA with seed `"vault"`
- `authority_token_account` (init_if_needed): Authority's ATA

### 3. register_miner
Registers a new miner with optional referral.

**Accounts:**
- `owner` (signer, mut)
- `miner_state` (init): PDA with seed `"miner_state" + owner`
- `referrer_state` (optional): Referrer's MinerState
- `system_program`

**Effects:**
- Creates MinerState with `gas_balance = 500`
- If referrer valid: Both get +100 gas bonus

### 4. enter_batch
Burns tokens to enter current puzzle batch.

**Accounts:**
- `owner` (signer)
- `global_state`
- `miner_state` (mut)
- `mint` (mut)
- `miner_token_account` (mut): Must have enough tokens
- `token_program`: Token-2022

**Effects:**
- Burns 1,000 ECASH (Era 1) or 500 ECASH (Era 2)
- Sets `in_current_batch = true`
- Sets `batch_entered = current_batch`

### 5. pick_puzzle
Selects a puzzle to solve.

**Accounts:**
- `owner` (signer)
- `global_state`
- `miner_state` (mut)

**Parameters:**
- `puzzle_id: u64`: Must be in current batch range

**Effects:**
- Costs 10 gas
- Sets `active_pick = puzzle_id`
- Sets `has_pick = true`

**Batch Range Formula:**
```
start = current_batch * 10
end = start + 9
```

### 6. commit_solve
Submits encrypted answer commitment.

**Accounts:**
- `owner` (signer)
- `miner_state` (mut)

**Parameters:**
- `commit_hash: [u8; 32]`: keccak256(answer || salt || secret || signer)

**Effects:**
- Costs 25 gas
- Sets `has_commit = true`
- Records `commit_slot`

### 7. reveal_solve
Reveals answer and claims reward if correct.

**Accounts:**
- `owner` (signer, mut)
- `global_state` (mut)
- `miner_state` (mut)
- `puzzle_solved` (init): PDA with seed `"puzzle_solved" + puzzle_id`
- `mint` (mut)
- `vault` (mut)
- `miner_token_account` (mut)
- `token_program`

**Parameters:**
- `puzzle_id: u64`
- `answer: String`
- `salt: [u8; 32]`
- `secret: [u8; 32]`
- `merkle_proof: Vec<[u8; 32]>`

**Validation:**
1. Must be different slot than commit
2. Commit hash must match: `keccak256(answer || salt || secret || signer)`
3. Merkle proof must verify answer
4. Puzzle must not be already solved

**Effects:**
- Creates PuzzleSolved account
- Mints 4,000 ECASH (Era 1) or 2,000 ECASH (Era 2)
- Adds 100 gas bonus
- Increments `total_solved`
- If 8 puzzles solved in batch: advances batch

### 8. clear_solved_pick
Clears pick if puzzle was solved by another miner.

**Accounts:**
- `owner` (signer)
- `miner_state` (mut)
- `puzzle_solved`: Must exist (proves puzzle solved)

### 9. claim_daily_gas
Regenerates gas (once per 24 hours).

**Accounts:**
- `owner` (signer)
- `miner_state` (mut)

**Effects:**
- Adds up to 100 gas (capped at 100 total)
- Only works if 24+ hours since last claim

### 10. cancel_expired_commit
Cancels commit after timeout.

**Accounts:**
- `owner` (signer)
- `miner_state` (mut)

**Conditions:**
- Must have commit
- Must be 300+ seconds since commit

### 11. force_advance_batch
Permissionless batch advancement when stale.

**Accounts:**
- `global_state` (mut)

**Conditions:**
- Cooldown must have passed (3600 seconds)

### 12. renounce_ownership
Permanently removes admin authority.

**Accounts:**
- `authority` (signer)
- `global_state` (mut)

---

## Puzzle Solving Flow

### Step 1: Register
```typescript
await program.methods.registerMiner()
  .accounts({
    owner: wallet.publicKey,
    minerState: minerStatePda,
    referrerState: null, // or referrer's PDA
    systemProgram: SystemProgram.programId,
  })
  .signers([wallet])
  .rpc();
```

### Step 2: Get Tokens
Transfer or buy ECASH tokens to pay entry fee.

### Step 3: Enter Batch
```typescript
await program.methods.enterBatch()
  .accounts({
    owner: wallet.publicKey,
    globalState: globalStatePda,
    minerState: minerStatePda,
    mint: mintPda,
    minerTokenAccount: walletAta,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .signers([wallet])
  .rpc();
```

### Step 4: Pick Puzzle
```typescript
await program.methods.pickPuzzle(new BN(puzzleId))
  .accounts({
    owner: wallet.publicKey,
    globalState: globalStatePda,
    minerState: minerStatePda,
  })
  .signers([wallet])
  .rpc();
```

### Step 5: Compute Commit Hash
```typescript
function computeCommitHash(answer, salt, secret, signer) {
  const answerBytes = Buffer.from(answer, "utf-8");
  const input = Buffer.concat([answerBytes, salt, secret, signer.toBuffer()]);
  return keccak256(input);
}
```

### Step 6: Commit
```typescript
const commitHash = computeCommitHash(answer, salt, secret, wallet.publicKey);
await program.methods.commitSolve([...commitHash])
  .accounts({
    owner: wallet.publicKey,
    minerState: minerStatePda,
  })
  .signers([wallet])
  .rpc();
```

### Step 7: Wait for New Slot
```typescript
await new Promise(r => setTimeout(r, 1500)); // ~1.5 seconds
```

### Step 8: Reveal
```typescript
await program.methods.revealSolve(
    new BN(puzzleId),
    answer,
    [...salt],
    [...secret],
    merkleProof.map(p => [...p])
  )
  .accounts({
    owner: wallet.publicKey,
    globalState: globalStatePda,
    minerState: minerStatePda,
    puzzleSolved: puzzleSolvedPda,
    mint: mintPda,
    vault: vaultPda,
    minerTokenAccount: walletAta,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([wallet])
  .rpc();
```

---

## API Server

### Start Server
```bash
cd api
npm install
npm start
# Runs on http://localhost:3001
```

### Endpoints

#### GET /health
Returns server status.

#### GET /state
Returns global protocol state.

#### GET /miner/:pubkey
Returns miner state for given public key.

#### GET /puzzle/:id
Returns puzzle status (solved/unsolved).

#### POST /register
Registers a new miner.
```json
{ "owner": "base58-pubkey", "referrer": "optional-base58-pubkey" }
```

#### POST /enter-batch
Enters current batch.
```json
{ "owner": "base58-pubkey" }
```

#### POST /pick
Picks a puzzle.
```json
{ "owner": "base58-pubkey", "puzzleId": 0 }
```

#### POST /commit
Submits commit hash.
```json
{ "owner": "base58-pubkey", "commitHash": "hex-string" }
```

#### POST /reveal
Reveals solution.
```json
{
  "owner": "base58-pubkey",
  "puzzleId": 0,
  "answer": "the rosetta stone",
  "salt": "hex-32-bytes",
  "secret": "hex-32-bytes",
  "proof": ["hex-32-bytes", ...]
}
```

---

## SDK Usage

### Installation
```typescript
import { EcashSDK } from './sdk';
```

### Initialize
```typescript
const sdk = new EcashSDK(connection, wallet, programId);
```

### Methods
```typescript
// Get global state
const state = await sdk.getGlobalState();

// Get miner state
const miner = await sdk.getMinerState(publicKey);

// Register
await sdk.register(referrer?);

// Enter batch
await sdk.enterBatch();

// Pick puzzle
await sdk.pickPuzzle(puzzleId);

// Commit
await sdk.commit(answer, salt, secret);

// Reveal
await sdk.reveal(puzzleId, answer, salt, secret, proof);

// Check if puzzle solved
const solved = await sdk.isPuzzleSolved(puzzleId);
```

---

## Constants Reference

### Token Economics
| Constant | Value |
|----------|-------|
| TOTAL_SUPPLY | 21,000,000 |
| MINING_RESERVE | 18,900,000 |
| LP_ALLOCATION | 2,100,000 |
| TOKEN_DECIMALS | 9 |

### Era System
| Era | Puzzles | Reward | Burn |
|-----|---------|--------|------|
| 1 | 0-3149 | 4,000 | 1,000 |
| 2 | 3150-6299 | 2,000 | 500 |

### Gas System
| Constant | Value |
|----------|-------|
| INITIAL_GAS | 500 |
| GAS_FLOOR | 35 |
| GAS_CAP | 100 |
| PICK_COST | 10 |
| COMMIT_COST | 25 |
| SOLVE_BONUS | 100 |
| REFERRAL_BONUS | 100 |

### Batch System
| Constant | Value |
|----------|-------|
| BATCH_SIZE | 10 |
| BATCH_THRESHOLD | 8 |
| BATCH_COOLDOWN | 3600 seconds |

### Timeouts
| Constant | Value |
|----------|-------|
| PICK_TIMEOUT | 86400 seconds (24h) |
| REVEAL_WINDOW | 300 seconds (5min) |
| LOCKOUT_DURATION | 86400 seconds |

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | AlreadyRegistered | Miner already registered |
| 6001 | NotRegistered | Miner not registered |
| 6002 | NotInBatch | Must enter batch first |
| 6003 | AlreadyInBatch | Already in current batch |
| 6004 | InsufficientGas | Not enough gas |
| 6005 | AlreadyHasPick | Already picked a puzzle |
| 6006 | NoPick | No active puzzle pick |
| 6007 | PuzzleOutOfBatchRange | Puzzle not in current batch |
| 6008 | AlreadyHasCommit | Already has active commit |
| 6009 | NoCommit | No active commit |
| 6010 | CommitHashMismatch | Reveal doesn't match commit |
| 6011 | CommitNotExpired | Cannot cancel unexpired commit |
| 6012 | SameSlotReveal | Cannot reveal in same slot |
| 6013 | RevealWindowExpired | Reveal window passed |
| 6014 | InvalidReferrer | Invalid referrer |
| 6015 | InvalidMerkleProof | Proof verification failed |
| 6016 | PuzzleAlreadySolved | Puzzle already solved |
| 6017 | PuzzleNotSolved | Puzzle not yet solved |
| 6018 | PuzzleMismatch | Wrong puzzle ID |
| 6019 | MaxAttemptsReached | Too many failed attempts |
| 6020 | LockedOut | Currently locked out |
| 6021 | SolveCooldownActive | Cooldown between solves |
| 6022 | NotAuthority | Not the authority |
| 6023 | AlreadyRenounced | Already renounced |
| 6024 | BatchNotStale | Batch not stale yet |
| 6025 | AllPuzzlesSolved | No more puzzles |
| 6026 | InvalidPuzzleId | Invalid puzzle ID |

---

## Merkle Proof Computation

### Leaf Computation
```typescript
function computeMerkleLeaf(puzzleId, normalizedAnswer, salt) {
  // ABI encode: (uint256, string, bytes32)
  const encoded = abiEncode(puzzleId, normalizedAnswer, salt);
  const innerHash = keccak256(encoded);
  return keccak256(innerHash);
}
```

### Answer Normalization
```typescript
function normalizeAnswer(answer) {
  // 1. Lowercase
  // 2. Keep only a-z, 0-9, space
  // 3. Trim whitespace
  // 4. Collapse multiple spaces
  return answer
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
```

### Proof Verification
For a leaf at index `i` in a tree of `n` leaves:
1. Start with leaf hash
2. For each proof element, combine with current hash using sorted pair hash
3. Result should equal merkle root

---

## Quick Start Checklist

1. [ ] Install dependencies: `npm install`
2. [ ] Start validator: `solana-test-validator --reset`
3. [ ] Build program: `anchor build --no-idl`
4. [ ] Deploy: `anchor deploy`
5. [ ] Run tests: `npm test`
6. [ ] Start API (optional): `cd api && npm start`

---

## Troubleshooting

### "DeclaredProgramIdMismatch"
- Ensure `lib.rs` declare_id matches `Anchor.toml`
- Run `anchor keys list` to get correct ID
- Update both files and rebuild

### "InvalidMerkleProof"
- Verify answer normalization matches program
- Check merkle root in lib.rs matches test data
- Verify proof elements are in correct order

### "SameSlotReveal"
- Wait at least 1.5 seconds between commit and reveal
- Solana slots are ~400ms

### "InsufficientGas"
- Pick costs 10 gas, commit costs 25 gas
- Use `claim_daily_gas` to regenerate
- Register gives 500 initial gas

---

**Program ID:** `7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u`
**Token Standard:** SPL Token-2022
**Network:** Solana Mainnet/Devnet/Localnet
