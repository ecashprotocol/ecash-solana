# Ecash Solana Program

A Solana implementation of the Ecash mining protocol, featuring commit-reveal puzzle solving, merkle proof verification, and deflationary tokenomics.

## Overview

Ecash is a puzzle-solving mining protocol where users:
1. **Register** as miners with optional referral bonuses
2. **Enter batches** by burning ECASH tokens
3. **Pick puzzles** from the current batch
4. **Commit** their solution hash
5. **Reveal** the answer with merkle proof to earn rewards

## Features

- **Fair Mining**: Commit-reveal pattern prevents front-running
- **Deflationary**: Token burning required to enter batches
- **Batch System**: 10 puzzles per batch with 1-hour cooldowns
- **Referral Bonuses**: +100 gas for using a referral
- **Token2022**: Uses Solana's Token-2022 program for the mint

## Quick Start

### Prerequisites

- Solana CLI v2.1+
- Anchor v0.30.1+
- Node.js v18+

### Build

```bash
# Install dependencies
npm install

# Build program
anchor build
# or
cargo build-sbf
```

### Test

```bash
# Start local validator
solana-test-validator --reset &

# Deploy and test
solana program deploy target/deploy/ecash_program.so
ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json npm test
```

### Deploy to Devnet

```bash
solana config set --url devnet
solana airdrop 2
solana program deploy target/deploy/ecash_program.so
```

## Architecture

### Accounts

| Account | Description | Size |
|---------|-------------|------|
| `GlobalState` | Protocol configuration, merkle root, batch state | ~150 bytes |
| `MinerState` | Per-user state: gas, picks, commits, solves | ~180 bytes |
| `PuzzleSolved` | Records which puzzles have been solved | ~57 bytes |

### Instructions

| Instruction | Description |
|-------------|-------------|
| `initialize_state` | One-time protocol setup |
| `initialize_vault` | Create token mint and vault |
| `register` | Register as a miner |
| `enter_batch` | Enter current batch (burns tokens) |
| `pick` | Choose a puzzle to solve |
| `commit_solve` | Submit solution hash |
| `reveal_solve` | Reveal answer and claim reward |
| `clear_solved_pick` | Clear solved puzzle from state |
| `cancel_expired_commit` | Cancel expired commit |
| `claim_daily_gas` | Regenerate gas (daily) |
| `renounce_ownership` | Make protocol immutable |
| `force_advance_stale_batch` | Advance stuck batch |

## Token Economics

**Total Supply**: 21,000,000 ECASH (fixed cap)

| Allocation | Amount | Purpose |
|------------|--------|---------|
| LP Allocation | 2,100,000 | Initial liquidity |
| Mining Reserve | 18,900,000 | Mining rewards |

### Era System (2 Eras)

| Era | Puzzle Range | Burn Amount | Reward |
|-----|--------------|-------------|--------|
| 1 | 0 - 3,149 | 1,000 ECASH | 4,000 ECASH |
| 2 | 3,150 - 6,299 | 500 ECASH | 2,000 ECASH |

## Protocol Flow

```
User Flow:
┌──────────┐    ┌────────────┐    ┌──────┐    ┌────────┐    ┌────────┐
│ register │───▶│ enter_batch│───▶│ pick │───▶│ commit │───▶│ reveal │
└──────────┘    └────────────┘    └──────┘    └────────┘    └────────┘
                     │                                            │
                     ▼                                            ▼
               Burn ECASH                                   Earn ECASH
```

## Merkle Proof Verification

Each puzzle answer is verified against a merkle tree:

1. Leaf: `keccak256(keccak256(abi_encode(puzzle_id, normalized_answer, salt)))`
2. Proof verification using OpenZeppelin-compatible sorted pair hashing
3. Verification against hardcoded merkle root

## Gas System

| Parameter | Value |
|-----------|-------|
| Initial Gas | 500 |
| Gas Floor | 35 |
| Gas Cap | 100 |
| Daily Regen | 100 |
| Pick Cost | 10 gas |
| Commit Cost | 25 gas |
| Solve Bonus | 100 gas |
| Referral Bonus | 100 gas |

## Security

### Commit-Reveal
- Prevents front-running of solutions
- 300 slot reveal window (~2 minutes)
- Commit hash: `keccak256(answer || salt || secret || signer)`

### Lockout Mechanism
- 3 incorrect attempts = 24-hour lockout
- Attempts reset after correct solve

### Immutability
- Authority can call `renounce_ownership`
- Makes merkle root and protocol rules permanent

## Program IDs

| Network | Program ID |
|---------|------------|
| Devnet | `7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u` |
| Mainnet | TBD |

## PDAs

```
GlobalState: seeds = ["global_state"]
Mint:        seeds = ["ecash_mint"]
Vault:       seeds = ["vault"]
MinerState:  seeds = ["miner_state", owner_pubkey]
PuzzleSolved: seeds = ["puzzle_solved", puzzle_id_le_bytes]
```

## Project Structure

```
ecash_program/
├── programs/
│   └── ecash_program/
│       └── src/
│           └── lib.rs          # Main program
├── tests/
│   └── ecash.test.ts           # Integration tests (57 tests)
├── target/
│   ├── idl/
│   │   └── ecash_program.json  # IDL file
│   └── deploy/
│       └── ecash_program.so    # Compiled program
├── Anchor.toml
├── Cargo.toml
├── package.json
├── DEPLOYMENT.md
└── README.md
```

## Related Projects

- **API Server**: `/Users/xen/ecash-api-solana/` - Express.js API with 10 endpoints
- **SDK**: `/Users/xen/ecash-sdk-solana/` - JavaScript SDK for mining
- **Skill**: `/Users/xen/ecash-skill-solana/` - ClawdHub AI agent skill

## Running Tests

```bash
# Start local validator
solana-test-validator --reset &

# Deploy program
solana program deploy target/deploy/ecash_program.so

# Run comprehensive tests (57 tests)
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npm test
```

## Events

| Event | Description |
|-------|-------------|
| `MinerRegistered` | New miner registered |
| `BatchEntered` | Miner entered batch |
| `PuzzlePicked` | Puzzle selected |
| `CommitMade` | Solution committed |
| `PuzzleRevealed` | Solution verified |
| `BatchAdvanced` | New batch started |

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | ArithmeticOverflow | Math overflow |
| 6001 | AlreadyRegistered | Double registration |
| 6002 | NotRegistered | Miner not registered |
| 6003 | AlreadyEnteredBatch | Already in batch |
| 6004 | NotEnteredBatch | Not in current batch |
| 6005 | CooldownActive | Batch cooldown |
| 6006 | LockedOut | User locked out |
| 6007 | PuzzleOutOfBatchRange | Puzzle not in batch |
| 6008 | AlreadyHasPick | Already picked |
| 6009 | NoPick | No active pick |
| 6010 | AlreadyHasCommit | Already committed |
| 6011 | NoCommit | No active commit |
| 6012 | SameSlotReveal | Reveal too fast |
| 6013 | RevealWindowExpired | Reveal too late |
| 6014 | InvalidCommitHash | Hash mismatch |
| 6015 | InvalidMerkleProof | Proof failed |
| 6016 | CommitNotExpired | Cannot cancel yet |
| 6017 | Unauthorized | Not authority |
| 6018 | AlreadyRenounced | Already immutable |
| 6019 | BatchNotStale | Batch not stuck |
| 6020 | PuzzleAlreadySolved | Already solved |
| 6021 | SelfReferralNotAllowed | Self-referral blocked |

## License

ISC

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests (all 57 must pass)
5. Submit a pull request
