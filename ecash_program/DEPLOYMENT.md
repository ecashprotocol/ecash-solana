# Ecash Program Deployment Guide

## Overview

This document provides instructions for deploying the Ecash Solana program to devnet and mainnet.

## Prerequisites

1. **Solana CLI** (v2.1+)
   ```bash
   solana --version
   ```

2. **Anchor CLI** (v0.30.1+)
   ```bash
   anchor --version
   ```

3. **Rust** with Solana BPF toolchain
   ```bash
   rustc --version
   ```

4. **Funded Wallet**
   - Devnet: ~3 SOL for deployment
   - Mainnet: ~3-5 SOL for deployment

## Build

1. Build the program:
   ```bash
   anchor build
   # or
   cargo build-sbf
   ```

2. Verify the program ID matches `declare_id!` in `lib.rs`:
   ```bash
   solana address -k target/deploy/ecash_program-keypair.json
   # Should output: 7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u
   ```

## Devnet Deployment

### 1. Configure for Devnet
```bash
solana config set --url devnet
```

### 2. Fund Your Wallet
```bash
# Check balance
solana balance

# Airdrop SOL (if available)
solana airdrop 2

# Or use web faucet: https://faucet.solana.com/
```

### 3. Deploy
```bash
solana program deploy target/deploy/ecash_program.so
```

### 4. Verify Deployment
```bash
solana program show 7Py13K2aXfXXyZYmofPo1EZZYwjrx34fMJmbGHiZrn6u
```

### 5. Initialize Protocol
Use the SDK or direct instructions to:
```bash
# 1. Initialize global state (creates mint)
# 2. Initialize vault (mints tokens)
```

## Mainnet Deployment

### Pre-Deployment Checklist

- [ ] All 57 tests pass on local validator
- [ ] Program tested on devnet
- [ ] Security audit completed
- [ ] Merkle root is finalized and verified
- [ ] LP allocation recipient address confirmed
- [ ] Upgrade authority decision made (keep or renounce)

### 1. Configure for Mainnet
```bash
solana config set --url mainnet-beta
```

### 2. Verify Wallet Balance
```bash
solana balance
# Ensure sufficient SOL for deployment (~3-5 SOL)
```

### 3. Deploy with Verification
```bash
solana program deploy target/deploy/ecash_program.so \
  --program-id target/deploy/ecash_program-keypair.json
```

### 4. Initialize Protocol
```bash
# Step 1: Initialize State (creates mint)
# Step 2: Initialize Vault (mints tokens)
```

### 5. Post-Deployment Verification
```bash
# Verify program
solana program show <PROGRAM_ID>

# Verify global state account
solana account <GLOBAL_STATE_PDA>
```

## Program Accounts

| Account | Description | Size |
|---------|-------------|------|
| GlobalState | Protocol state, merkle root | ~150 bytes |
| MinerState | Per-miner state | ~180 bytes |
| PuzzleSolved | Records solved puzzles | ~57 bytes |
| Mint | ECASH token mint (PDA) | Token2022 |
| Vault | Mining reward reserve | Token Account |

## Key PDAs

All PDAs are derived from the program ID:

```
GlobalState:  seeds = ["global_state"]
Mint:         seeds = ["ecash_mint"]
Vault:        seeds = ["vault"]
MinerState:   seeds = ["miner_state", owner_pubkey]
PuzzleSolved: seeds = ["puzzle_solved", puzzle_id_le_bytes]
```

## Token Economics

| Allocation | Amount | Purpose |
|------------|--------|---------|
| LP Allocation | 2,100,000 | Liquidity provision |
| Mining Reserve | 18,900,000 | Mining rewards |
| **Total Supply** | **21,000,000** | Fixed cap |

## Era System

| Era | Puzzles Range | Burn Amount | Reward |
|-----|---------------|-------------|--------|
| 1 | 0 - 3,149 | 1,000 ECASH | 4,000 ECASH |
| 2 | 3,150 - 6,299 | 500 ECASH | 2,000 ECASH |

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

## Security Considerations

### Upgrade Authority
- The program is deployed with an upgrade authority
- Call `renounce_ownership` to make the program immutable
- This is irreversible

### Merkle Root
- The merkle root is hardcoded in the program
- Contains all 6,300 puzzle answers with their salts
- Puzzles are released in batches of 10

### Commit-Reveal
- 300 slot reveal window (~2 minutes)
- Commit hash: keccak256(answer || salt || secret || signer)
- Prevents front-running

## Monitoring

### Key Metrics to Track
- Total puzzles solved (`global_state.total_solved`)
- Current batch (`global_state.current_batch`)
- Total tokens burned (`global_state.total_burned`)
- Vault balance (remaining mining rewards)

### Events
The program emits the following events:
- `MinerRegistered` - New miner registered
- `BatchEntered` - Miner entered a batch
- `PuzzlePicked` - Miner picked a puzzle
- `CommitMade` - Solution committed
- `PuzzleRevealed` - Solution revealed and verified
- `BatchAdvanced` - Batch advanced (after cooldown)

## Troubleshooting

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| NotRegistered | Miner not registered | Call `register` first |
| NotEnteredBatch | Miner not in current batch | Call `enter_batch` |
| PuzzleOutOfBatchRange | Puzzle not in active batch | Pick from current batch (0-9) |
| InvalidCommitHash | Answer/salt/secret mismatch | Check commit hash computation |
| InvalidMerkleProof | Wrong proof or answer | Verify merkle proof |
| SameSlotReveal | Revealed too quickly | Wait for slot change |
| RevealWindowExpired | Took too long to reveal | Re-commit within window |
| InsufficientGas | Not enough gas | Wait for daily regen |

### Running Tests
```bash
# Local validator
solana-test-validator --reset &

# Deploy
solana program deploy target/deploy/ecash_program.so

# Run tests (57 tests)
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npm test
```

## Related Tools

- **API Server**: Express.js server with 10 endpoints
  - Location: `/Users/xen/ecash-api-solana/`
  - Start: `npm start`
  - Endpoints: /health, /stats, /puzzles, /contract, /leaderboard, /activity, /miner/:address

- **SDK**: JavaScript SDK for building transactions
  - Location: `/Users/xen/ecash-sdk-solana/`
  - Usage: `const { EcashSDK } = require('ecash-sdk-solana')`

- **Skill**: ClawdHub AI agent skill
  - Location: `/Users/xen/ecash-skill-solana/SKILL.md`

## Support

For issues, please open a GitHub issue or contact the team.
