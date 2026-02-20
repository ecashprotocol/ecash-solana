use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{
    burn, mint_to, transfer_checked, token_metadata_initialize, Burn, Mint, MintTo,
    TokenAccount, TokenInterface, TokenMetadataInitialize, TransferChecked,
};
use spl_token_metadata_interface::state::TokenMetadata;
use spl_type_length_value::variable_len_pack::VariableLenPack;

declare_id!("w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY");

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Ecash Protocol",
    project_url: "https://ecash.bot",
    contacts: "twitter:@getecash",
    policy: "https://github.com/ecashprotocol/ecash-solana/security",
    preferred_languages: "en",
    source_code: "https://github.com/ecashprotocol/ecash-solana",
    source_release: "v1.0.0",
    auditors: "N/A"
}

// ============================================================================
// MINING CONSTANTS (MUST MATCH EVM VERSION EXACTLY)
// ============================================================================

pub const TOTAL_PUZZLES: u64 = 6_300;
pub const TOTAL_SUPPLY: u64 = 21_000_000;
pub const MINING_RESERVE: u64 = 18_900_000;
pub const LP_ALLOCATION: u64 = 2_100_000;
pub const TOKEN_DECIMALS: u8 = 9;

// 2 Eras - puzzle ranges (matching Base version)
pub const ERA1_END: u64 = 3_150; // puzzles 0-3149
pub const ERA2_END: u64 = 6_300; // puzzles 3150-6299

// Rewards per era (in token base units, multiply by 10^decimals)
pub const ERA1_REWARD: u64 = 4_000;
pub const ERA2_REWARD: u64 = 2_000;

// Burn amounts per era for batch entry
pub const ERA1_BURN: u64 = 1_000;
pub const ERA2_BURN: u64 = 500;

// Batch settings
pub const BATCH_SIZE: u64 = 10;
pub const BATCH_THRESHOLD: u64 = 8; // 8/10 to advance
pub const BATCH_COOLDOWN: i64 = 3600; // 1 hour in seconds

// Gas system (matching Base version)
pub const INITIAL_GAS: u64 = 500;
pub const GAS_FLOOR: u64 = 35;
pub const GAS_CAP: u64 = 100;
pub const GAS_REGEN_RATE: u64 = 100; // daily regen
pub const PICK_COST: u64 = 10;
pub const COMMIT_COST: u64 = 25;
pub const SOLVE_BONUS: u64 = 100;
pub const REFERRAL_BONUS: u64 = 100;
pub const MAX_ATTEMPTS: u8 = 3;
pub const LOCKOUT_DURATION: i64 = 86400; // 24 hours
pub const SOLVE_COOLDOWN: i64 = 300; // 5 minutes
pub const PICK_TIMEOUT: i64 = 86400; // 24 hours
pub const REVEAL_WINDOW: u64 = 300; // ~300 slots on Solana (~2 min)

// Merkle root (6,300 puzzles from Base mainnet)
pub const MERKLE_ROOT: [u8; 32] = [
    0xc0, 0x6f, 0x6d, 0x42, 0xc5, 0x08, 0x31, 0xeb, 0x4f, 0x10, 0x15, 0x6b, 0x06, 0x68, 0x70, 0x3e,
    0x70, 0x32, 0xf2, 0x03, 0x63, 0x74, 0x01, 0x07, 0x1e, 0x9c, 0xf9, 0xca, 0xd4, 0x6a, 0xb7, 0xa9,
];

// ============================================================================
// MARKETPLACE CONSTANTS
// ============================================================================

pub const MIN_JOB_AMOUNT: u64 = 10; // 10 ECASH minimum
pub const MIN_DEADLINE_SECONDS: i64 = 3600; // 1 hour
pub const MAX_DEADLINE_SECONDS: i64 = 30 * 24 * 3600; // 30 days
pub const ESCROW_FEE_BPS: u64 = 200; // 2% burn on completion
pub const DISPUTE_FEE_BPS: u64 = 500; // 5% to file dispute
pub const ARBITRATOR_STAKE: u64 = 25; // 25 ECASH per arbitrator
pub const VOTE_DEADLINE_SECONDS: i64 = 48 * 3600; // 48 hours
pub const MAX_DESCRIPTION_LENGTH: usize = 200;
pub const MAX_RESULT_HASH_LENGTH: usize = 32;

// ============================================================================
// REPUTATION CONSTANTS
// ============================================================================

pub const TIER_BRONZE: u64 = 1;
pub const TIER_SILVER: u64 = 10;
pub const TIER_GOLD: u64 = 25;
pub const TIER_DIAMOND: u64 = 50;
pub const MIN_ARBITRATOR_TIER: u64 = 2; // Silver
pub const MIN_ARBITRATOR_ACCURACY_BPS: u64 = 6000; // 60%
pub const MAX_NAME_LENGTH: usize = 50;
pub const MAX_PROFILE_DESC_LENGTH: usize = 200;

// ============================================================================
// PDA SEEDS
// ============================================================================

// Mining seeds
pub const GLOBAL_STATE_SEED: &[u8] = b"global_state";
pub const MINER_STATE_SEED: &[u8] = b"miner_state";
pub const PUZZLE_SOLVED_SEED: &[u8] = b"puzzle_solved";
pub const VAULT_SEED: &[u8] = b"vault";
pub const MINT_SEED: &[u8] = b"ecash_mint";

// Marketplace seeds
pub const JOB_SEED: &[u8] = b"job";
pub const JOB_ESCROW_SEED: &[u8] = b"job_escrow";
pub const DISPUTE_SEED: &[u8] = b"dispute";

// Reputation seeds
pub const AGENT_PROFILE_SEED: &[u8] = b"agent_profile";
pub const ARBITRATOR_STATS_SEED: &[u8] = b"arbitrator_stats";
pub const ARBITRATOR_REGISTRY_SEED: &[u8] = b"arbitrator_registry";
pub const ARBITRATOR_COUNT_SEED: &[u8] = b"arbitrator_count";

// ============================================================================
// PROGRAM
// ============================================================================

#[program]
pub mod ecash_program {
    use super::*;

    // ========================================================================
    // MINING INSTRUCTIONS
    // ========================================================================

    /// Initialize step 1: Create global state and mint
    pub fn initialize_state(ctx: Context<InitializeState>) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;

        global_state.authority = ctx.accounts.authority.key();
        global_state.mint = ctx.accounts.mint.key();
        global_state.merkle_root = MERKLE_ROOT;
        global_state.total_solved = 0;
        global_state.current_batch = 0;
        global_state.batch_solve_count = 0;
        global_state.cooldown_end = 0;
        global_state.total_burned = 0;
        global_state.is_renounced = false;
        global_state.bump = ctx.bumps.global_state;
        global_state.mint_bump = ctx.bumps.mint;
        global_state.vault_bump = 0;
        // Marketplace stats
        global_state.total_jobs_created = 0;
        global_state.total_jobs_completed = 0;
        global_state.total_disputes = 0;
        global_state.total_escrow_burned = 0;
        // Reputation stats
        global_state.total_agents_registered = 0;
        global_state.total_arbitrators = 0;
        global_state.next_job_id = 0;

        // ====================================================================
        // Initialize Token-2022 Metadata Extension
        // ====================================================================
        let name = "Ecash".to_string();
        let symbol = "ECASH".to_string();
        let uri = "https://raw.githubusercontent.com/ecashprotocol/ecash-solana/main/token-metadata.json".to_string();

        // Calculate rent needed for metadata
        let token_metadata = TokenMetadata {
            name: name.clone(),
            symbol: symbol.clone(),
            uri: uri.clone(),
            update_authority: Some(ctx.accounts.authority.key()).try_into().unwrap(),
            mint: ctx.accounts.mint.key(),
            additional_metadata: vec![],
        };

        let data_len = 4 + token_metadata.get_packed_len().map_err(|_| EcashError::Overflow)?;
        let lamports_needed = Rent::get()?.minimum_balance(data_len);

        // Transfer additional lamports for metadata storage
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.mint.to_account_info(),
                },
            ),
            lamports_needed,
        )?;

        // Initialize token metadata (mint PDA signs for itself)
        let seeds = &[MINT_SEED, &[ctx.bumps.mint]];
        let signer_seeds = &[&seeds[..]];

        token_metadata_initialize(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TokenMetadataInitialize {
                    token_program_id: ctx.accounts.token_program.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    metadata: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.mint.to_account_info(),
                    update_authority: ctx.accounts.authority.to_account_info(),
                },
                signer_seeds,
            ),
            name,
            symbol,
            uri,
        )?;

        msg!("Ecash state initialized with token metadata");
        Ok(())
    }

    /// Initialize step 2: Create vault and distribute initial tokens
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        global_state.vault_bump = ctx.bumps.vault;

        let decimal_multiplier = 10u64.pow(TOKEN_DECIMALS as u32);
        let lp_allocation_with_decimals = LP_ALLOCATION
            .checked_mul(decimal_multiplier)
            .ok_or(EcashError::Overflow)?;
        let mining_reserve_with_decimals = MINING_RESERVE
            .checked_mul(decimal_multiplier)
            .ok_or(EcashError::Overflow)?;

        let seeds = &[MINT_SEED, &[global_state.mint_bump]];
        let signer_seeds = &[&seeds[..]];

        // Mint LP allocation to deployer
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.authority_token_account.to_account_info(),
                    authority: ctx.accounts.mint.to_account_info(),
                },
                signer_seeds,
            ),
            lp_allocation_with_decimals,
        )?;

        // Mint mining reserve to vault
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.mint.to_account_info(),
                },
                signer_seeds,
            ),
            mining_reserve_with_decimals,
        )?;

        msg!("Ecash vault initialized");
        Ok(())
    }

    /// Register a new miner
    pub fn register(ctx: Context<Register>, referrer: Pubkey) -> Result<()> {
        let miner = &mut ctx.accounts.miner_state;
        let clock = Clock::get()?;

        require!(!miner.registered, EcashError::AlreadyRegistered);

        miner.owner = ctx.accounts.owner.key();
        miner.registered = true;
        miner.gas_balance = INITIAL_GAS;
        miner.entered_batch = u64::MAX;
        miner.has_pick = false;
        miner.active_pick = 0;
        miner.pick_timestamp = 0;
        miner.has_commit = false;
        miner.commit_hash = [0u8; 32];
        miner.commit_slot = 0;
        miner.attempts = 0;
        miner.lockout_end = 0;
        miner.last_solve_time = 0;
        miner.solve_count = 0;
        miner.last_regen_time = clock.unix_timestamp;
        miner.referrer = referrer;
        miner.bump = ctx.bumps.miner_state;

        // Handle referral bonus
        if referrer != Pubkey::default() && referrer != ctx.accounts.owner.key() {
            if let Some(referrer_account) = ctx.remaining_accounts.first() {
                if referrer_account.owner == ctx.program_id {
                    let data = referrer_account.try_borrow_data()?;
                    if data.len() > 40 && data[40] == 1 {
                        miner.gas_balance = miner
                            .gas_balance
                            .checked_add(REFERRAL_BONUS)
                            .ok_or(EcashError::Overflow)?;
                    }
                }
            }
        }

        emit!(MinerRegistered {
            miner: ctx.accounts.owner.key(),
            referrer,
        });

        Ok(())
    }

    /// Enter the current batch by burning ECASH
    pub fn enter_batch(ctx: Context<EnterBatch>) -> Result<()> {
        let miner = &mut ctx.accounts.miner_state;
        let global_state = &mut ctx.accounts.global_state;

        require!(miner.registered, EcashError::NotRegistered);
        require!(
            miner.entered_batch != global_state.current_batch,
            EcashError::AlreadyEnteredBatch
        );

        let burn_amount = get_burn_amount(global_state.total_solved)?;
        let decimal_multiplier = 10u64.pow(TOKEN_DECIMALS as u32);
        let burn_amount_with_decimals = burn_amount
            .checked_mul(decimal_multiplier)
            .ok_or(EcashError::Overflow)?;

        burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.miner_token_account.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            burn_amount_with_decimals,
        )?;

        // Track total burned
        global_state.total_burned = global_state
            .total_burned
            .checked_add(burn_amount_with_decimals)
            .ok_or(EcashError::Overflow)?;

        miner.entered_batch = global_state.current_batch;

        emit!(BatchEntered {
            miner: ctx.accounts.owner.key(),
            batch: global_state.current_batch,
            burned: burn_amount_with_decimals,
        });

        Ok(())
    }

    /// Pick a puzzle to solve
    pub fn pick(ctx: Context<Pick>, puzzle_id: u64) -> Result<()> {
        let miner = &mut ctx.accounts.miner_state;
        let global_state = &ctx.accounts.global_state;
        let clock = Clock::get()?;

        require!(miner.registered, EcashError::NotRegistered);
        require!(
            miner.entered_batch == global_state.current_batch,
            EcashError::NotEnteredBatch
        );
        require!(
            clock.unix_timestamp >= global_state.cooldown_end,
            EcashError::CooldownActive
        );
        require!(clock.unix_timestamp >= miner.lockout_end, EcashError::LockedOut);

        let batch_start = global_state.current_batch.checked_mul(BATCH_SIZE).ok_or(EcashError::Overflow)?;
        let batch_end = batch_start.checked_add(BATCH_SIZE).ok_or(EcashError::Overflow)?.min(TOTAL_PUZZLES);

        require!(
            puzzle_id >= batch_start && puzzle_id < batch_end,
            EcashError::PuzzleOutOfBatchRange
        );

        if miner.has_pick {
            let pick_expired = clock.unix_timestamp > miner.pick_timestamp + PICK_TIMEOUT;
            if pick_expired {
                miner.has_pick = false;
                miner.active_pick = 0;
                miner.pick_timestamp = 0;
            } else {
                return err!(EcashError::AlreadyHasPick);
            }
        }

        if miner.gas_balance > GAS_FLOOR {
            miner.gas_balance = miner.gas_balance.checked_sub(PICK_COST).ok_or(EcashError::Overflow)?.max(GAS_FLOOR);
        }

        miner.has_pick = true;
        miner.active_pick = puzzle_id;
        miner.pick_timestamp = clock.unix_timestamp;

        emit!(PuzzlePicked {
            miner: ctx.accounts.owner.key(),
            puzzle_id,
        });

        Ok(())
    }

    /// Commit a solution hash
    pub fn commit_solve(ctx: Context<CommitSolve>, commit_hash: [u8; 32]) -> Result<()> {
        let miner = &mut ctx.accounts.miner_state;
        let clock = Clock::get()?;

        require!(miner.registered, EcashError::NotRegistered);
        require!(miner.has_pick, EcashError::NoPick);
        require!(clock.unix_timestamp >= miner.lockout_end, EcashError::LockedOut);

        if miner.has_commit {
            let commit_expired = clock.slot > miner.commit_slot + REVEAL_WINDOW;
            if commit_expired {
                miner.has_commit = false;
                miner.commit_hash = [0u8; 32];
                miner.commit_slot = 0;
            } else {
                return err!(EcashError::AlreadyHasCommit);
            }
        }

        if miner.gas_balance > GAS_FLOOR {
            miner.gas_balance = miner.gas_balance.checked_sub(COMMIT_COST).ok_or(EcashError::Overflow)?.max(GAS_FLOOR);
        }

        miner.attempts = miner.attempts.checked_add(1).ok_or(EcashError::Overflow)?;

        if miner.attempts >= MAX_ATTEMPTS {
            miner.lockout_end = clock.unix_timestamp.checked_add(LOCKOUT_DURATION).ok_or(EcashError::Overflow)?;
            miner.attempts = 0;
        }

        miner.has_commit = true;
        miner.commit_hash = commit_hash;
        miner.commit_slot = clock.slot;

        emit!(CommitMade {
            miner: ctx.accounts.owner.key(),
            puzzle_id: miner.active_pick,
        });

        Ok(())
    }

    /// Reveal a solution and claim reward
    pub fn reveal_solve(
        ctx: Context<RevealSolve>,
        answer: String,
        salt: [u8; 32],
        secret: [u8; 32],
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let miner = &mut ctx.accounts.miner_state;
        let global_state = &mut ctx.accounts.global_state;
        let puzzle_solved = &mut ctx.accounts.puzzle_solved;
        let clock = Clock::get()?;

        require!(miner.registered, EcashError::NotRegistered);
        require!(miner.has_pick, EcashError::NoPick);
        require!(miner.has_commit, EcashError::NoCommit);
        require!(clock.slot > miner.commit_slot, EcashError::SameSlotReveal);
        require!(clock.slot <= miner.commit_slot + REVEAL_WINDOW, EcashError::RevealWindowExpired);

        let expected_commit = compute_commit_hash(&answer, &salt, &secret, &ctx.accounts.owner.key());
        require!(miner.commit_hash == expected_commit, EcashError::InvalidCommitHash);

        let normalized_answer = normalize_answer(&answer);
        let leaf = compute_merkle_leaf(miner.active_pick, &normalized_answer, &salt)?;
        require!(verify_merkle_proof(&proof, &global_state.merkle_root, &leaf), EcashError::InvalidMerkleProof);

        puzzle_solved.puzzle_id = miner.active_pick;
        puzzle_solved.solver = ctx.accounts.owner.key();
        puzzle_solved.solved_at = clock.unix_timestamp;
        puzzle_solved.bump = ctx.bumps.puzzle_solved;

        global_state.total_solved = global_state.total_solved.checked_add(1).ok_or(EcashError::Overflow)?;
        global_state.batch_solve_count = global_state.batch_solve_count.checked_add(1).ok_or(EcashError::Overflow)?;

        miner.has_pick = false;
        miner.active_pick = 0;
        miner.pick_timestamp = 0;
        miner.has_commit = false;
        miner.commit_hash = [0u8; 32];
        miner.commit_slot = 0;
        miner.attempts = 0;
        miner.last_solve_time = clock.unix_timestamp;
        miner.solve_count = miner.solve_count.checked_add(1).ok_or(EcashError::Overflow)?;
        miner.gas_balance = miner.gas_balance.checked_add(SOLVE_BONUS).ok_or(EcashError::Overflow)?;

        let reward = get_reward_amount(global_state.total_solved.saturating_sub(1))?;
        let decimal_multiplier = 10u64.pow(TOKEN_DECIMALS as u32);
        let reward_with_decimals = reward.checked_mul(decimal_multiplier).ok_or(EcashError::Overflow)?;

        let vault_seeds = &[VAULT_SEED, &[global_state.vault_bump]];
        let signer_seeds = &[&vault_seeds[..]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.miner_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
                signer_seeds,
            ),
            reward_with_decimals,
            TOKEN_DECIMALS,
        )?;

        if global_state.batch_solve_count >= BATCH_THRESHOLD {
            global_state.current_batch = global_state.current_batch.checked_add(1).ok_or(EcashError::Overflow)?;
            global_state.batch_solve_count = 0;
            global_state.cooldown_end = clock.unix_timestamp.checked_add(BATCH_COOLDOWN).ok_or(EcashError::Overflow)?;

            emit!(BatchAdvanced {
                new_batch: global_state.current_batch,
                cooldown_end: global_state.cooldown_end,
            });
        }

        emit!(PuzzleRevealed {
            miner: ctx.accounts.owner.key(),
            puzzle_id: puzzle_solved.puzzle_id,
            reward: reward_with_decimals,
        });

        Ok(())
    }

    /// Clear a pick if the puzzle was solved by someone else
    pub fn clear_solved_pick(ctx: Context<ClearSolvedPick>) -> Result<()> {
        let miner = &mut ctx.accounts.miner_state;
        require!(miner.has_pick, EcashError::NoPick);

        miner.has_pick = false;
        miner.active_pick = 0;
        miner.pick_timestamp = 0;
        miner.has_commit = false;
        miner.commit_hash = [0u8; 32];
        miner.commit_slot = 0;

        Ok(())
    }

    /// Cancel an expired commit
    pub fn cancel_expired_commit(ctx: Context<CancelExpiredCommit>) -> Result<()> {
        let miner = &mut ctx.accounts.miner_state;
        let clock = Clock::get()?;

        require!(miner.has_commit, EcashError::NoCommit);
        require!(clock.slot > miner.commit_slot + REVEAL_WINDOW, EcashError::CommitNotExpired);

        miner.has_commit = false;
        miner.commit_hash = [0u8; 32];
        miner.commit_slot = 0;

        Ok(())
    }

    /// Claim daily gas regeneration
    pub fn claim_daily_gas(ctx: Context<ClaimDailyGas>) -> Result<()> {
        let miner = &mut ctx.accounts.miner_state;
        let clock = Clock::get()?;

        require!(miner.registered, EcashError::NotRegistered);

        let time_elapsed = clock.unix_timestamp.saturating_sub(miner.last_regen_time);
        let days_elapsed = time_elapsed / 86400;

        if days_elapsed > 0 {
            let gas_owed = (days_elapsed as u64).checked_mul(GAS_REGEN_RATE).ok_or(EcashError::Overflow)?;
            let new_gas = miner.gas_balance.checked_add(gas_owed).ok_or(EcashError::Overflow)?.min(miner.gas_balance + GAS_CAP);
            miner.gas_balance = new_gas;
            miner.last_regen_time = clock.unix_timestamp;
        }

        Ok(())
    }

    /// Renounce ownership
    pub fn renounce_ownership(ctx: Context<RenounceOwnership>) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        require!(ctx.accounts.authority.key() == global_state.authority, EcashError::Unauthorized);
        require!(!global_state.is_renounced, EcashError::AlreadyRenounced);

        global_state.is_renounced = true;
        global_state.authority = Pubkey::default();

        msg!("Ownership renounced");
        Ok(())
    }

    /// Force advance a stale batch
    pub fn force_advance_stale_batch(ctx: Context<ForceAdvanceStaleBatch>) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        let clock = Clock::get()?;

        let stale_threshold: i64 = 7 * 24 * 60 * 60;
        require!(
            global_state.cooldown_end > 0 && clock.unix_timestamp > global_state.cooldown_end + stale_threshold,
            EcashError::BatchNotStale
        );

        global_state.current_batch = global_state.current_batch.checked_add(1).ok_or(EcashError::Overflow)?;
        global_state.batch_solve_count = 0;
        global_state.cooldown_end = clock.unix_timestamp.checked_add(BATCH_COOLDOWN).ok_or(EcashError::Overflow)?;

        emit!(BatchAdvanced {
            new_batch: global_state.current_batch,
            cooldown_end: global_state.cooldown_end,
        });

        Ok(())
    }

    // ========================================================================
    // MARKETPLACE INSTRUCTIONS
    // ========================================================================

    /// Create a new job with ECASH locked in escrow
    pub fn create_job(
        ctx: Context<CreateJob>,
        amount: u64,
        deadline_seconds: i64,
        description: String,
    ) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        let job = &mut ctx.accounts.job;
        let clock = Clock::get()?;

        // Validations
        require!(amount >= MIN_JOB_AMOUNT, EcashError::JobBelowMinimum);
        require!(deadline_seconds >= MIN_DEADLINE_SECONDS, EcashError::DeadlineTooShort);
        require!(deadline_seconds <= MAX_DEADLINE_SECONDS, EcashError::DeadlineTooLong);
        require!(!description.is_empty(), EcashError::EmptyDescription);
        require!(description.len() <= MAX_DESCRIPTION_LENGTH, EcashError::DescriptionTooLong);

        let decimal_multiplier = 10u64.pow(TOKEN_DECIMALS as u32);
        let amount_with_decimals = amount.checked_mul(decimal_multiplier).ok_or(EcashError::Overflow)?;

        // Transfer ECASH to job escrow
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.hirer_token_account.to_account_info(),
                    to: ctx.accounts.job_escrow.to_account_info(),
                    authority: ctx.accounts.hirer.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            amount_with_decimals,
            TOKEN_DECIMALS,
        )?;

        // Initialize job
        let job_id = global_state.next_job_id;
        job.job_id = job_id;
        job.hirer = ctx.accounts.hirer.key();
        job.worker = Pubkey::default();
        job.amount = amount_with_decimals;
        job.deadline = clock.unix_timestamp.checked_add(deadline_seconds).ok_or(EcashError::Overflow)?;
        job.created_at = clock.unix_timestamp;
        job.accepted_at = 0;
        job.submitted_at = 0;
        job.completed_at = 0;
        job.status = JobStatus::Open;
        job.description = description.clone();
        job.result_hash = vec![];
        job.bump = ctx.bumps.job;
        job.escrow_bump = ctx.bumps.job_escrow;

        // Update global state
        global_state.next_job_id = global_state.next_job_id.checked_add(1).ok_or(EcashError::Overflow)?;
        global_state.total_jobs_created = global_state.total_jobs_created.checked_add(1).ok_or(EcashError::Overflow)?;

        emit!(JobCreated {
            job_id,
            hirer: ctx.accounts.hirer.key(),
            amount: amount_with_decimals,
            deadline: job.deadline,
            description,
        });

        Ok(())
    }

    /// Accept an open job as worker
    pub fn accept_job(ctx: Context<AcceptJob>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        let clock = Clock::get()?;

        require!(job.status == JobStatus::Open, EcashError::JobNotOpen);
        require!(ctx.accounts.worker.key() != job.hirer, EcashError::CannotSelfHire);
        require!(clock.unix_timestamp < job.deadline, EcashError::DeadlinePassed);

        job.worker = ctx.accounts.worker.key();
        job.status = JobStatus::Accepted;
        job.accepted_at = clock.unix_timestamp;

        emit!(JobAccepted {
            job_id: job.job_id,
            worker: ctx.accounts.worker.key(),
        });

        Ok(())
    }

    /// Submit completed work
    pub fn submit_work(ctx: Context<SubmitWork>, result_hash: Vec<u8>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        let clock = Clock::get()?;

        require!(job.status == JobStatus::Accepted, EcashError::JobNotAccepted);
        require!(ctx.accounts.worker.key() == job.worker, EcashError::NotWorker);
        require!(clock.unix_timestamp <= job.deadline, EcashError::DeadlinePassed);
        require!(!result_hash.is_empty(), EcashError::EmptyResult);
        require!(result_hash.len() <= MAX_RESULT_HASH_LENGTH, EcashError::ResultTooLong);

        job.result_hash = result_hash.clone();
        job.status = JobStatus::WorkSubmitted;
        job.submitted_at = clock.unix_timestamp;

        emit!(WorkSubmitted {
            job_id: job.job_id,
            result_hash,
        });

        Ok(())
    }

    /// Confirm job completion and pay worker
    pub fn confirm_job(ctx: Context<ConfirmJob>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        let global_state = &mut ctx.accounts.global_state;
        let clock = Clock::get()?;

        require!(job.status == JobStatus::WorkSubmitted, EcashError::JobNotSubmitted);
        require!(ctx.accounts.hirer.key() == job.hirer, EcashError::NotHirer);

        // Calculate burn (2%) and worker pay (98%)
        let burn_amount = job.amount.checked_mul(ESCROW_FEE_BPS).ok_or(EcashError::Overflow)?.checked_div(10000).ok_or(EcashError::Overflow)?;
        let worker_pay = job.amount.checked_sub(burn_amount).ok_or(EcashError::Overflow)?;

        // Transfer to worker
        let job_id_bytes = job.job_id.to_le_bytes();
        let escrow_seeds = &[JOB_ESCROW_SEED, job_id_bytes.as_ref(), &[job.escrow_bump]];
        let signer_seeds = &[&escrow_seeds[..]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.job_escrow.to_account_info(),
                    to: ctx.accounts.worker_token_account.to_account_info(),
                    authority: ctx.accounts.job_escrow.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
                signer_seeds,
            ),
            worker_pay,
            TOKEN_DECIMALS,
        )?;

        // Burn the fee
        burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.job_escrow.to_account_info(),
                    authority: ctx.accounts.job_escrow.to_account_info(),
                },
                signer_seeds,
            ),
            burn_amount,
        )?;

        job.status = JobStatus::Completed;
        job.completed_at = clock.unix_timestamp;

        global_state.total_jobs_completed = global_state.total_jobs_completed.checked_add(1).ok_or(EcashError::Overflow)?;
        global_state.total_escrow_burned = global_state.total_escrow_burned.checked_add(burn_amount).ok_or(EcashError::Overflow)?;

        // Update worker reputation
        let worker_profile = &mut ctx.accounts.worker_profile;
        worker_profile.jobs_completed_as_worker = worker_profile
            .jobs_completed_as_worker
            .checked_add(1)
            .ok_or(EcashError::Overflow)?;

        emit!(JobConfirmed {
            job_id: job.job_id,
            worker_paid: worker_pay,
            burned: burn_amount,
        });

        Ok(())
    }

    /// Cancel job before it's accepted
    pub fn cancel_job(ctx: Context<CancelJob>) -> Result<()> {
        let job = &mut ctx.accounts.job;

        require!(ctx.accounts.hirer.key() == job.hirer, EcashError::NotHirer);
        require!(job.status == JobStatus::Open, EcashError::JobNotOpen);

        // Return funds to hirer
        let job_id_bytes = job.job_id.to_le_bytes();
        let escrow_seeds = &[JOB_ESCROW_SEED, job_id_bytes.as_ref(), &[job.escrow_bump]];
        let signer_seeds = &[&escrow_seeds[..]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.job_escrow.to_account_info(),
                    to: ctx.accounts.hirer_token_account.to_account_info(),
                    authority: ctx.accounts.job_escrow.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
                signer_seeds,
            ),
            job.amount,
            TOKEN_DECIMALS,
        )?;

        job.status = JobStatus::Cancelled;

        emit!(JobCancelled { job_id: job.job_id });

        Ok(())
    }

    /// Reclaim funds from expired job
    pub fn reclaim_expired(ctx: Context<ReclaimExpired>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        let clock = Clock::get()?;

        require!(ctx.accounts.hirer.key() == job.hirer, EcashError::NotHirer);
        require!(clock.unix_timestamp > job.deadline, EcashError::JobNotExpired);
        require!(
            job.status == JobStatus::Open || job.status == JobStatus::Accepted,
            EcashError::CannotReclaim
        );

        let job_id_bytes = job.job_id.to_le_bytes();
        let escrow_seeds = &[JOB_ESCROW_SEED, job_id_bytes.as_ref(), &[job.escrow_bump]];
        let signer_seeds = &[&escrow_seeds[..]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.job_escrow.to_account_info(),
                    to: ctx.accounts.hirer_token_account.to_account_info(),
                    authority: ctx.accounts.job_escrow.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
                signer_seeds,
            ),
            job.amount,
            TOKEN_DECIMALS,
        )?;

        job.status = JobStatus::Cancelled;

        emit!(JobReclaimed { job_id: job.job_id });

        Ok(())
    }

    /// File a dispute on a job with submitted work
    pub fn file_dispute(ctx: Context<FileDispute>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        let dispute = &mut ctx.accounts.dispute;
        let global_state = &mut ctx.accounts.global_state;
        let clock = Clock::get()?;

        require!(job.status == JobStatus::WorkSubmitted, EcashError::JobNotSubmitted);
        require!(
            ctx.accounts.disputer.key() == job.hirer || ctx.accounts.disputer.key() == job.worker,
            EcashError::NotParty
        );

        // Calculate dispute fee (5% of job value, min 1 ECASH)
        let decimal_multiplier = 10u64.pow(TOKEN_DECIMALS as u32);
        let mut dispute_fee = job.amount.checked_mul(DISPUTE_FEE_BPS).ok_or(EcashError::Overflow)?.checked_div(10000).ok_or(EcashError::Overflow)?;
        if dispute_fee < decimal_multiplier {
            dispute_fee = decimal_multiplier;
        }

        // Transfer dispute fee
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.disputer_token_account.to_account_info(),
                    to: ctx.accounts.job_escrow.to_account_info(),
                    authority: ctx.accounts.disputer.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            dispute_fee,
            TOKEN_DECIMALS,
        )?;

        // Initialize dispute
        dispute.job_id = job.job_id;
        dispute.disputer = ctx.accounts.disputer.key();
        dispute.dispute_fee = dispute_fee;
        dispute.filed_at = clock.unix_timestamp;
        dispute.vote_deadline = clock.unix_timestamp.checked_add(VOTE_DEADLINE_SECONDS).ok_or(EcashError::Overflow)?;
        dispute.arbitrator_1 = Pubkey::default();
        dispute.arbitrator_2 = Pubkey::default();
        dispute.arbitrator_3 = Pubkey::default();
        dispute.vote_1 = Vote::None;
        dispute.vote_2 = Vote::None;
        dispute.vote_3 = Vote::None;
        dispute.stake_1 = 0;
        dispute.stake_2 = 0;
        dispute.stake_3 = 0;
        dispute.votes_received = 0;
        dispute.arbitrator_count = 0;
        dispute.outcome = DisputeOutcome::Pending;
        dispute.resolved = false;
        dispute.bump = ctx.bumps.dispute;

        job.status = JobStatus::Disputed;
        global_state.total_disputes = global_state.total_disputes.checked_add(1).ok_or(EcashError::Overflow)?;

        emit!(DisputeFiled {
            job_id: job.job_id,
            disputer: ctx.accounts.disputer.key(),
            fee: dispute_fee,
        });

        Ok(())
    }

    /// Assign arbitrator to dispute (called by arbitrator staking)
    pub fn assign_arbitrator(ctx: Context<AssignArbitrator>) -> Result<()> {
        let dispute = &mut ctx.accounts.dispute;
        let arb_stats = &ctx.accounts.arbitrator_stats;
        let clock = Clock::get()?;

        // Verify arbitrator is eligible
        require!(arb_stats.enrolled, EcashError::NotEnrolledArbitrator);
        require!(is_accuracy_eligible(arb_stats.disputes_handled, arb_stats.correct_votes), EcashError::AccuracyTooLow);

        // Verify not a party to the dispute
        let job = &ctx.accounts.job;
        require!(
            ctx.accounts.arbitrator.key() != job.hirer && ctx.accounts.arbitrator.key() != job.worker,
            EcashError::CannotArbitrateOwnDispute
        );

        // Check slot availability
        require!(dispute.arbitrator_count < 3, EcashError::TooManyArbitrators);
        require!(!dispute.resolved, EcashError::DisputeAlreadyResolved);
        require!(clock.unix_timestamp <= dispute.vote_deadline, EcashError::VotingEnded);

        // Verify not already assigned
        require!(
            ctx.accounts.arbitrator.key() != dispute.arbitrator_1 &&
            ctx.accounts.arbitrator.key() != dispute.arbitrator_2 &&
            ctx.accounts.arbitrator.key() != dispute.arbitrator_3,
            EcashError::AlreadyAssigned
        );

        // Transfer stake
        let decimal_multiplier = 10u64.pow(TOKEN_DECIMALS as u32);
        let stake_amount = ARBITRATOR_STAKE.checked_mul(decimal_multiplier).ok_or(EcashError::Overflow)?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.arbitrator_token_account.to_account_info(),
                    to: ctx.accounts.job_escrow.to_account_info(),
                    authority: ctx.accounts.arbitrator.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            stake_amount,
            TOKEN_DECIMALS,
        )?;

        // Assign to slot
        let slot = dispute.arbitrator_count;
        match slot {
            0 => {
                dispute.arbitrator_1 = ctx.accounts.arbitrator.key();
                dispute.stake_1 = stake_amount;
            }
            1 => {
                dispute.arbitrator_2 = ctx.accounts.arbitrator.key();
                dispute.stake_2 = stake_amount;
            }
            2 => {
                dispute.arbitrator_3 = ctx.accounts.arbitrator.key();
                dispute.stake_3 = stake_amount;
            }
            _ => return err!(EcashError::TooManyArbitrators),
        }

        dispute.arbitrator_count = dispute.arbitrator_count.checked_add(1).ok_or(EcashError::Overflow)?;

        emit!(ArbitratorAssigned {
            job_id: dispute.job_id,
            arbitrator: ctx.accounts.arbitrator.key(),
            slot,
        });

        Ok(())
    }

    /// Vote on a dispute as an assigned arbitrator
    pub fn vote_on_dispute(ctx: Context<VoteOnDispute>, vote: Vote) -> Result<()> {
        let dispute = &mut ctx.accounts.dispute;
        let clock = Clock::get()?;

        require!(!dispute.resolved, EcashError::DisputeAlreadyResolved);
        require!(vote == Vote::HirerWins || vote == Vote::WorkerWins, EcashError::InvalidVote);
        require!(clock.unix_timestamp <= dispute.vote_deadline, EcashError::VotingEnded);

        // Find arbitrator slot and verify not already voted
        let arbitrator = ctx.accounts.arbitrator.key();
        let slot: u8;
        if arbitrator == dispute.arbitrator_1 {
            require!(dispute.vote_1 == Vote::None, EcashError::AlreadyVoted);
            dispute.vote_1 = vote;
            slot = 0;
        } else if arbitrator == dispute.arbitrator_2 {
            require!(dispute.vote_2 == Vote::None, EcashError::AlreadyVoted);
            dispute.vote_2 = vote;
            slot = 1;
        } else if arbitrator == dispute.arbitrator_3 {
            require!(dispute.vote_3 == Vote::None, EcashError::AlreadyVoted);
            dispute.vote_3 = vote;
            slot = 2;
        } else {
            return err!(EcashError::NotArbitrator);
        }

        dispute.votes_received = dispute.votes_received.checked_add(1).ok_or(EcashError::Overflow)?;

        emit!(ArbitratorVoted {
            job_id: dispute.job_id,
            arbitrator,
            vote,
        });

        Ok(())
    }

    /// Resolve dispute after voting
    pub fn resolve_dispute(ctx: Context<ResolveDispute>) -> Result<()> {
        let job = &mut ctx.accounts.job;
        let dispute = &mut ctx.accounts.dispute;
        let global_state = &mut ctx.accounts.global_state;
        let clock = Clock::get()?;

        require!(!dispute.resolved, EcashError::DisputeAlreadyResolved);
        require!(
            dispute.votes_received == dispute.arbitrator_count || clock.unix_timestamp > dispute.vote_deadline,
            EcashError::VotingStillOpen
        );

        // Count votes
        let mut hirer_votes: u8 = 0;
        let mut worker_votes: u8 = 0;

        if dispute.vote_1 == Vote::HirerWins { hirer_votes += 1; }
        else if dispute.vote_1 == Vote::WorkerWins { worker_votes += 1; }

        if dispute.vote_2 == Vote::HirerWins { hirer_votes += 1; }
        else if dispute.vote_2 == Vote::WorkerWins { worker_votes += 1; }

        if dispute.vote_3 == Vote::HirerWins { hirer_votes += 1; }
        else if dispute.vote_3 == Vote::WorkerWins { worker_votes += 1; }

        // Determine outcome
        let outcome = if hirer_votes > worker_votes {
            DisputeOutcome::HirerWins
        } else if worker_votes > hirer_votes {
            DisputeOutcome::WorkerWins
        } else {
            // Tie or no votes: default to hirer wins
            DisputeOutcome::HirerWins
        };

        dispute.outcome = outcome;
        dispute.resolved = true;
        job.status = JobStatus::Resolved;
        job.completed_at = clock.unix_timestamp;

        // Calculate distribution
        let job_id_bytes = job.job_id.to_le_bytes();
        let escrow_seeds = &[JOB_ESCROW_SEED, job_id_bytes.as_ref(), &[job.escrow_bump]];
        let signer_seeds = &[&escrow_seeds[..]];

        if outcome == DisputeOutcome::HirerWins {
            // Return full amount to hirer
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.job_escrow.to_account_info(),
                        to: ctx.accounts.hirer_token_account.to_account_info(),
                        authority: ctx.accounts.job_escrow.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                job.amount,
                TOKEN_DECIMALS,
            )?;
        } else {
            // Pay worker with 2% burn
            let burn_amount = job.amount.checked_mul(ESCROW_FEE_BPS).ok_or(EcashError::Overflow)?.checked_div(10000).ok_or(EcashError::Overflow)?;
            let worker_pay = job.amount.checked_sub(burn_amount).ok_or(EcashError::Overflow)?;

            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.job_escrow.to_account_info(),
                        to: ctx.accounts.worker_token_account.to_account_info(),
                        authority: ctx.accounts.job_escrow.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                worker_pay,
                TOKEN_DECIMALS,
            )?;

            burn(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Burn {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.job_escrow.to_account_info(),
                        authority: ctx.accounts.job_escrow.to_account_info(),
                    },
                    signer_seeds,
                ),
                burn_amount,
            )?;

            global_state.total_escrow_burned = global_state.total_escrow_burned.checked_add(burn_amount).ok_or(EcashError::Overflow)?;
        }

        emit!(DisputeResolved {
            job_id: job.job_id,
            outcome,
        });

        Ok(())
    }

    // ========================================================================
    // REPUTATION INSTRUCTIONS
    // ========================================================================

    /// Register an agent profile (requires Bronze tier - 1+ solve)
    pub fn register_profile(ctx: Context<RegisterProfile>, name: String, description: String) -> Result<()> {
        let profile = &mut ctx.accounts.agent_profile;
        let miner_state = &ctx.accounts.miner_state;
        let global_state = &mut ctx.accounts.global_state;
        let clock = Clock::get()?;

        require!(miner_state.solve_count >= TIER_BRONZE, EcashError::NotVerified);
        require!(!name.is_empty(), EcashError::EmptyName);
        require!(name.len() <= MAX_NAME_LENGTH, EcashError::NameTooLong);
        require!(description.len() <= MAX_PROFILE_DESC_LENGTH, EcashError::DescriptionTooLong);

        profile.owner = ctx.accounts.owner.key();
        profile.name = name.clone();
        profile.description = description;
        profile.registered_at = clock.unix_timestamp;
        profile.active = true;
        profile.cached_solve_count = miner_state.solve_count;
        profile.cached_tier = get_tier(miner_state.solve_count);
        profile.jobs_posted = 0;
        profile.jobs_completed_as_hirer = 0;
        profile.jobs_completed_as_worker = 0;
        profile.disputes_as_party = 0;
        profile.disputes_won = 0;
        profile.disputes_lost = 0;
        profile.bump = ctx.bumps.agent_profile;

        global_state.total_agents_registered = global_state.total_agents_registered.checked_add(1).ok_or(EcashError::Overflow)?;

        emit!(ProfileRegistered {
            agent: ctx.accounts.owner.key(),
            name,
        });

        Ok(())
    }

    /// Update agent profile
    pub fn update_profile(ctx: Context<UpdateProfile>, name: String, description: String) -> Result<()> {
        let profile = &mut ctx.accounts.agent_profile;
        let miner_state = &ctx.accounts.miner_state;

        require!(!name.is_empty(), EcashError::EmptyName);
        require!(name.len() <= MAX_NAME_LENGTH, EcashError::NameTooLong);
        require!(description.len() <= MAX_PROFILE_DESC_LENGTH, EcashError::DescriptionTooLong);

        profile.name = name;
        profile.description = description;
        profile.cached_solve_count = miner_state.solve_count;
        profile.cached_tier = get_tier(miner_state.solve_count);

        emit!(ProfileUpdated {
            agent: ctx.accounts.owner.key(),
        });

        Ok(())
    }

    /// Refresh cached solve count
    pub fn refresh_solve_count(ctx: Context<RefreshSolveCount>) -> Result<()> {
        let profile = &mut ctx.accounts.agent_profile;
        let miner_state = &ctx.accounts.miner_state;

        profile.cached_solve_count = miner_state.solve_count;
        profile.cached_tier = get_tier(miner_state.solve_count);

        emit!(SolveCountUpdated {
            agent: profile.owner,
            count: miner_state.solve_count,
        });

        Ok(())
    }

    /// Enroll as arbitrator (requires Silver tier - 10+ solves)
    pub fn enroll_as_arbitrator(ctx: Context<EnrollAsArbitrator>) -> Result<()> {
        let profile = &ctx.accounts.agent_profile;
        let arb_stats = &mut ctx.accounts.arbitrator_stats;
        let global_state = &mut ctx.accounts.global_state;
        let clock = Clock::get()?;

        require!(profile.cached_solve_count >= TIER_SILVER, EcashError::BelowSilverTier);
        require!(!arb_stats.enrolled, EcashError::AlreadyEnrolledArbitrator);

        arb_stats.owner = ctx.accounts.owner.key();
        arb_stats.enrolled = true;
        arb_stats.enrolled_at = clock.unix_timestamp;
        arb_stats.disputes_handled = 0;
        arb_stats.correct_votes = 0;
        arb_stats.total_earned = 0;
        arb_stats.total_slashed = 0;
        arb_stats.last_case_at = 0;
        arb_stats.bump = ctx.bumps.arbitrator_stats;

        global_state.total_arbitrators = global_state.total_arbitrators.checked_add(1).ok_or(EcashError::Overflow)?;

        emit!(ArbitratorEnrolled {
            agent: ctx.accounts.owner.key(),
        });

        Ok(())
    }

    /// Withdraw from arbitration
    pub fn withdraw_from_arbitration(ctx: Context<WithdrawFromArbitration>) -> Result<()> {
        let arb_stats = &mut ctx.accounts.arbitrator_stats;
        let global_state = &mut ctx.accounts.global_state;

        require!(arb_stats.enrolled, EcashError::NotEnrolledArbitrator);

        arb_stats.enrolled = false;

        global_state.total_arbitrators = global_state.total_arbitrators.saturating_sub(1);

        emit!(ArbitratorWithdrawn {
            agent: ctx.accounts.owner.key(),
        });

        Ok(())
    }
}

// ============================================================================
// ACCOUNT STRUCTURES
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub merkle_root: [u8; 32],
    pub total_solved: u64,
    pub current_batch: u64,
    pub batch_solve_count: u64,
    pub cooldown_end: i64,
    pub total_burned: u64,
    pub is_renounced: bool,
    pub bump: u8,
    pub mint_bump: u8,
    pub vault_bump: u8,
    // Marketplace
    pub total_jobs_created: u64,
    pub total_jobs_completed: u64,
    pub total_disputes: u64,
    pub total_escrow_burned: u64,
    pub next_job_id: u64,
    // Reputation
    pub total_agents_registered: u64,
    pub total_arbitrators: u64,
}

#[account]
#[derive(InitSpace)]
pub struct MinerState {
    pub owner: Pubkey,
    pub registered: bool,
    pub gas_balance: u64,
    pub entered_batch: u64,
    pub has_pick: bool,
    pub active_pick: u64,
    pub pick_timestamp: i64,
    pub has_commit: bool,
    pub commit_hash: [u8; 32],
    pub commit_slot: u64,
    pub attempts: u8,
    pub lockout_end: i64,
    pub last_solve_time: i64,
    pub solve_count: u64,
    pub last_regen_time: i64,
    pub referrer: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PuzzleSolved {
    pub puzzle_id: u64,
    pub solver: Pubkey,
    pub solved_at: i64,
    pub bump: u8,
}

// Marketplace accounts

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Default)]
pub enum JobStatus {
    #[default]
    Open,
    Accepted,
    WorkSubmitted,
    Completed,
    Cancelled,
    Disputed,
    Resolved,
}

#[account]
#[derive(InitSpace)]
pub struct Job {
    pub job_id: u64,
    pub hirer: Pubkey,
    pub worker: Pubkey,
    pub amount: u64,
    pub deadline: i64,
    pub created_at: i64,
    pub accepted_at: i64,
    pub submitted_at: i64,
    pub completed_at: i64,
    pub status: JobStatus,
    #[max_len(200)]
    pub description: String,
    #[max_len(32)]
    pub result_hash: Vec<u8>,
    pub bump: u8,
    pub escrow_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Default)]
pub enum Vote {
    #[default]
    None,
    HirerWins,
    WorkerWins,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Default)]
pub enum DisputeOutcome {
    #[default]
    Pending,
    HirerWins,
    WorkerWins,
}

#[account]
#[derive(InitSpace)]
pub struct Dispute {
    pub job_id: u64,
    pub disputer: Pubkey,
    pub dispute_fee: u64,
    pub filed_at: i64,
    pub vote_deadline: i64,
    pub arbitrator_1: Pubkey,
    pub arbitrator_2: Pubkey,
    pub arbitrator_3: Pubkey,
    pub vote_1: Vote,
    pub vote_2: Vote,
    pub vote_3: Vote,
    pub stake_1: u64,
    pub stake_2: u64,
    pub stake_3: u64,
    pub votes_received: u8,
    pub arbitrator_count: u8,
    pub outcome: DisputeOutcome,
    pub resolved: bool,
    pub bump: u8,
}

// Reputation accounts

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Default)]
pub enum Tier {
    #[default]
    Unranked,
    Bronze,
    Silver,
    Gold,
    Diamond,
}

#[account]
#[derive(InitSpace)]
pub struct AgentProfile {
    pub owner: Pubkey,
    #[max_len(50)]
    pub name: String,
    #[max_len(200)]
    pub description: String,
    pub registered_at: i64,
    pub active: bool,
    pub cached_solve_count: u64,
    pub cached_tier: Tier,
    pub jobs_posted: u64,
    pub jobs_completed_as_hirer: u64,
    pub jobs_completed_as_worker: u64,
    pub disputes_as_party: u64,
    pub disputes_won: u64,
    pub disputes_lost: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ArbitratorStats {
    pub owner: Pubkey,
    pub enrolled: bool,
    pub enrolled_at: i64,
    pub disputes_handled: u64,
    pub correct_votes: u64,
    pub total_earned: u64,
    pub total_slashed: u64,
    pub last_case_at: i64,
    pub bump: u8,
}

// ============================================================================
// ACCOUNT VALIDATION STRUCTS - MINING
// ============================================================================

#[derive(Accounts)]
pub struct InitializeState<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + GlobalState::INIT_SPACE,
        seeds = [GLOBAL_STATE_SEED],
        bump
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    /// The mint account - created with metadata pointer extension
    /// Points to itself for embedded metadata
    #[account(
        init,
        payer = authority,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = mint,
        // NO freeze authority - gives "No Blacklist" on Rugcheck
        extensions::metadata_pointer::authority = authority,
        extensions::metadata_pointer::metadata_address = mint,
        seeds = [MINT_SEED],
        bump
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump,
        has_one = authority
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        mut,
        seeds = [MINT_SEED],
        bump = global_state.mint_bump
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = vault,
        seeds = [VAULT_SEED],
        bump
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = authority,
        associated_token::token_program = token_program,
    )]
    pub authority_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Register<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + MinerState::INIT_SPACE,
        seeds = [MINER_STATE_SEED, owner.key().as_ref()],
        bump
    )]
    pub miner_state: Account<'info, MinerState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EnterBatch<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MINER_STATE_SEED, owner.key().as_ref()],
        bump = miner_state.bump,
        has_one = owner
    )]
    pub miner_state: Account<'info, MinerState>,

    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(mut, seeds = [MINT_SEED], bump = global_state.mint_bump)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub miner_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Pick<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MINER_STATE_SEED, owner.key().as_ref()],
        bump = miner_state.bump,
        has_one = owner
    )]
    pub miner_state: Account<'info, MinerState>,

    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
}

#[derive(Accounts)]
pub struct CommitSolve<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MINER_STATE_SEED, owner.key().as_ref()],
        bump = miner_state.bump,
        has_one = owner
    )]
    pub miner_state: Account<'info, MinerState>,
}

#[derive(Accounts)]
pub struct RevealSolve<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MINER_STATE_SEED, owner.key().as_ref()],
        bump = miner_state.bump,
        has_one = owner
    )]
    pub miner_state: Box<Account<'info, MinerState>>,

    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        init,
        payer = owner,
        space = 8 + PuzzleSolved::INIT_SPACE,
        seeds = [PUZZLE_SOLVED_SEED, &miner_state.active_pick.to_le_bytes()],
        bump
    )]
    pub puzzle_solved: Box<Account<'info, PuzzleSolved>>,

    #[account(seeds = [MINT_SEED], bump = global_state.mint_bump)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, seeds = [VAULT_SEED], bump = global_state.vault_bump)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub miner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClearSolvedPick<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MINER_STATE_SEED, owner.key().as_ref()],
        bump = miner_state.bump,
        has_one = owner
    )]
    pub miner_state: Account<'info, MinerState>,

    #[account(
        seeds = [PUZZLE_SOLVED_SEED, &miner_state.active_pick.to_le_bytes()],
        bump = puzzle_solved.bump
    )]
    pub puzzle_solved: Account<'info, PuzzleSolved>,
}

#[derive(Accounts)]
pub struct CancelExpiredCommit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MINER_STATE_SEED, owner.key().as_ref()],
        bump = miner_state.bump,
        has_one = owner
    )]
    pub miner_state: Account<'info, MinerState>,
}

#[derive(Accounts)]
pub struct ClaimDailyGas<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MINER_STATE_SEED, owner.key().as_ref()],
        bump = miner_state.bump,
        has_one = owner
    )]
    pub miner_state: Account<'info, MinerState>,

    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
}

#[derive(Accounts)]
pub struct RenounceOwnership<'info> {
    pub authority: Signer<'info>,

    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
}

#[derive(Accounts)]
pub struct ForceAdvanceStaleBatch<'info> {
    pub caller: Signer<'info>,

    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
}

// ============================================================================
// ACCOUNT VALIDATION STRUCTS - MARKETPLACE
// ============================================================================

#[derive(Accounts)]
pub struct CreateJob<'info> {
    #[account(mut)]
    pub hirer: Signer<'info>,

    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        init,
        payer = hirer,
        space = 8 + Job::INIT_SPACE,
        seeds = [JOB_SEED, &global_state.next_job_id.to_le_bytes()],
        bump
    )]
    pub job: Box<Account<'info, Job>>,

    #[account(
        init,
        payer = hirer,
        token::mint = mint,
        token::authority = job_escrow,
        seeds = [JOB_ESCROW_SEED, &global_state.next_job_id.to_le_bytes()],
        bump
    )]
    pub job_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(seeds = [MINT_SEED], bump = global_state.mint_bump)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = hirer,
        associated_token::token_program = token_program,
    )]
    pub hirer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptJob<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,

    #[account(
        mut,
        seeds = [JOB_SEED, &job.job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Account<'info, Job>,
}

#[derive(Accounts)]
pub struct SubmitWork<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,

    #[account(
        mut,
        seeds = [JOB_SEED, &job.job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Account<'info, Job>,
}

#[derive(Accounts)]
pub struct ConfirmJob<'info> {
    #[account(mut)]
    pub hirer: Signer<'info>,

    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        mut,
        seeds = [JOB_SEED, &job.job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Box<Account<'info, Job>>,

    #[account(
        mut,
        seeds = [JOB_ESCROW_SEED, &job.job_id.to_le_bytes()],
        bump = job.escrow_bump
    )]
    pub job_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, seeds = [MINT_SEED], bump = global_state.mint_bump)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Worker's token account, validated by constraint
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = job.worker,
        associated_token::token_program = token_program,
    )]
    pub worker_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [AGENT_PROFILE_SEED, job.worker.as_ref()],
        bump = worker_profile.bump
    )]
    pub worker_profile: Box<Account<'info, AgentProfile>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CancelJob<'info> {
    #[account(mut)]
    pub hirer: Signer<'info>,

    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        mut,
        seeds = [JOB_SEED, &job.job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Box<Account<'info, Job>>,

    #[account(
        mut,
        seeds = [JOB_ESCROW_SEED, &job.job_id.to_le_bytes()],
        bump = job.escrow_bump
    )]
    pub job_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(seeds = [MINT_SEED], bump = global_state.mint_bump)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = hirer,
        associated_token::token_program = token_program,
    )]
    pub hirer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ReclaimExpired<'info> {
    #[account(mut)]
    pub hirer: Signer<'info>,

    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        mut,
        seeds = [JOB_SEED, &job.job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Box<Account<'info, Job>>,

    #[account(
        mut,
        seeds = [JOB_ESCROW_SEED, &job.job_id.to_le_bytes()],
        bump = job.escrow_bump
    )]
    pub job_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(seeds = [MINT_SEED], bump = global_state.mint_bump)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = hirer,
        associated_token::token_program = token_program,
    )]
    pub hirer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct FileDispute<'info> {
    #[account(mut)]
    pub disputer: Signer<'info>,

    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        mut,
        seeds = [JOB_SEED, &job.job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Box<Account<'info, Job>>,

    #[account(
        init,
        payer = disputer,
        space = 8 + Dispute::INIT_SPACE,
        seeds = [DISPUTE_SEED, &job.job_id.to_le_bytes()],
        bump
    )]
    pub dispute: Box<Account<'info, Dispute>>,

    #[account(
        mut,
        seeds = [JOB_ESCROW_SEED, &job.job_id.to_le_bytes()],
        bump = job.escrow_bump
    )]
    pub job_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(seeds = [MINT_SEED], bump = global_state.mint_bump)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = disputer,
        associated_token::token_program = token_program,
    )]
    pub disputer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AssignArbitrator<'info> {
    #[account(mut)]
    pub arbitrator: Signer<'info>,

    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(seeds = [JOB_SEED, &job.job_id.to_le_bytes()], bump = job.bump)]
    pub job: Box<Account<'info, Job>>,

    #[account(
        mut,
        seeds = [DISPUTE_SEED, &job.job_id.to_le_bytes()],
        bump = dispute.bump
    )]
    pub dispute: Box<Account<'info, Dispute>>,

    #[account(
        seeds = [ARBITRATOR_STATS_SEED, arbitrator.key().as_ref()],
        bump = arbitrator_stats.bump
    )]
    pub arbitrator_stats: Box<Account<'info, ArbitratorStats>>,

    #[account(
        mut,
        seeds = [JOB_ESCROW_SEED, &job.job_id.to_le_bytes()],
        bump = job.escrow_bump
    )]
    pub job_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(seeds = [MINT_SEED], bump = global_state.mint_bump)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = arbitrator,
        associated_token::token_program = token_program,
    )]
    pub arbitrator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct VoteOnDispute<'info> {
    #[account(mut)]
    pub arbitrator: Signer<'info>,

    #[account(
        mut,
        seeds = [DISPUTE_SEED, &dispute.job_id.to_le_bytes()],
        bump = dispute.bump
    )]
    pub dispute: Account<'info, Dispute>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        mut,
        seeds = [JOB_SEED, &job.job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Box<Account<'info, Job>>,

    #[account(
        mut,
        seeds = [DISPUTE_SEED, &job.job_id.to_le_bytes()],
        bump = dispute.bump
    )]
    pub dispute: Box<Account<'info, Dispute>>,

    #[account(
        mut,
        seeds = [JOB_ESCROW_SEED, &job.job_id.to_le_bytes()],
        bump = job.escrow_bump
    )]
    pub job_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, seeds = [MINT_SEED], bump = global_state.mint_bump)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Hirer token account
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = job.hirer,
        associated_token::token_program = token_program,
    )]
    pub hirer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Worker token account
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = job.worker,
        associated_token::token_program = token_program,
    )]
    pub worker_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

// ============================================================================
// ACCOUNT VALIDATION STRUCTS - REPUTATION
// ============================================================================

#[derive(Accounts)]
pub struct RegisterProfile<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        seeds = [MINER_STATE_SEED, owner.key().as_ref()],
        bump = miner_state.bump
    )]
    pub miner_state: Account<'info, MinerState>,

    #[account(
        init,
        payer = owner,
        space = 8 + AgentProfile::INIT_SPACE,
        seeds = [AGENT_PROFILE_SEED, owner.key().as_ref()],
        bump
    )]
    pub agent_profile: Account<'info, AgentProfile>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [MINER_STATE_SEED, owner.key().as_ref()],
        bump = miner_state.bump
    )]
    pub miner_state: Account<'info, MinerState>,

    #[account(
        mut,
        seeds = [AGENT_PROFILE_SEED, owner.key().as_ref()],
        bump = agent_profile.bump,
        has_one = owner
    )]
    pub agent_profile: Account<'info, AgentProfile>,
}

#[derive(Accounts)]
pub struct RefreshSolveCount<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [MINER_STATE_SEED, owner.key().as_ref()],
        bump = miner_state.bump
    )]
    pub miner_state: Account<'info, MinerState>,

    #[account(
        mut,
        seeds = [AGENT_PROFILE_SEED, owner.key().as_ref()],
        bump = agent_profile.bump,
        has_one = owner
    )]
    pub agent_profile: Account<'info, AgentProfile>,
}

#[derive(Accounts)]
pub struct EnrollAsArbitrator<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        seeds = [AGENT_PROFILE_SEED, owner.key().as_ref()],
        bump = agent_profile.bump,
        has_one = owner
    )]
    pub agent_profile: Account<'info, AgentProfile>,

    #[account(
        init,
        payer = owner,
        space = 8 + ArbitratorStats::INIT_SPACE,
        seeds = [ARBITRATOR_STATS_SEED, owner.key().as_ref()],
        bump
    )]
    pub arbitrator_stats: Account<'info, ArbitratorStats>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawFromArbitration<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        mut,
        seeds = [ARBITRATOR_STATS_SEED, owner.key().as_ref()],
        bump = arbitrator_stats.bump,
        has_one = owner
    )]
    pub arbitrator_stats: Account<'info, ArbitratorStats>,
}

// ============================================================================
// EVENTS - MINING
// ============================================================================

#[event]
pub struct MinerRegistered {
    pub miner: Pubkey,
    pub referrer: Pubkey,
}

#[event]
pub struct BatchEntered {
    pub miner: Pubkey,
    pub batch: u64,
    pub burned: u64,
}

#[event]
pub struct PuzzlePicked {
    pub miner: Pubkey,
    pub puzzle_id: u64,
}

#[event]
pub struct CommitMade {
    pub miner: Pubkey,
    pub puzzle_id: u64,
}

#[event]
pub struct PuzzleRevealed {
    pub miner: Pubkey,
    pub puzzle_id: u64,
    pub reward: u64,
}

#[event]
pub struct BatchAdvanced {
    pub new_batch: u64,
    pub cooldown_end: i64,
}

// ============================================================================
// EVENTS - MARKETPLACE
// ============================================================================

#[event]
pub struct JobCreated {
    pub job_id: u64,
    pub hirer: Pubkey,
    pub amount: u64,
    pub deadline: i64,
    pub description: String,
}

#[event]
pub struct JobAccepted {
    pub job_id: u64,
    pub worker: Pubkey,
}

#[event]
pub struct WorkSubmitted {
    pub job_id: u64,
    pub result_hash: Vec<u8>,
}

#[event]
pub struct JobConfirmed {
    pub job_id: u64,
    pub worker_paid: u64,
    pub burned: u64,
}

#[event]
pub struct JobCancelled {
    pub job_id: u64,
}

#[event]
pub struct JobReclaimed {
    pub job_id: u64,
}

#[event]
pub struct DisputeFiled {
    pub job_id: u64,
    pub disputer: Pubkey,
    pub fee: u64,
}

#[event]
pub struct ArbitratorAssigned {
    pub job_id: u64,
    pub arbitrator: Pubkey,
    pub slot: u8,
}

#[event]
pub struct ArbitratorVoted {
    pub job_id: u64,
    pub arbitrator: Pubkey,
    pub vote: Vote,
}

#[event]
pub struct DisputeResolved {
    pub job_id: u64,
    pub outcome: DisputeOutcome,
}

// ============================================================================
// EVENTS - REPUTATION
// ============================================================================

#[event]
pub struct ProfileRegistered {
    pub agent: Pubkey,
    pub name: String,
}

#[event]
pub struct ProfileUpdated {
    pub agent: Pubkey,
}

#[event]
pub struct SolveCountUpdated {
    pub agent: Pubkey,
    pub count: u64,
}

#[event]
pub struct ArbitratorEnrolled {
    pub agent: Pubkey,
}

#[event]
pub struct ArbitratorWithdrawn {
    pub agent: Pubkey,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum EcashError {
    // General
    #[msg("Arithmetic overflow")]
    Overflow,

    // Mining
    #[msg("Already registered")]
    AlreadyRegistered,
    #[msg("Not registered")]
    NotRegistered,
    #[msg("Already entered current batch")]
    AlreadyEnteredBatch,
    #[msg("Not entered current batch")]
    NotEnteredBatch,
    #[msg("Batch cooldown is active")]
    CooldownActive,
    #[msg("User is locked out")]
    LockedOut,
    #[msg("Puzzle is out of current batch range")]
    PuzzleOutOfBatchRange,
    #[msg("Already has an active pick")]
    AlreadyHasPick,
    #[msg("No active pick")]
    NoPick,
    #[msg("Already has an active commit")]
    AlreadyHasCommit,
    #[msg("No active commit")]
    NoCommit,
    #[msg("Cannot reveal in same slot as commit")]
    SameSlotReveal,
    #[msg("Reveal window has expired")]
    RevealWindowExpired,
    #[msg("Invalid commit hash")]
    InvalidCommitHash,
    #[msg("Invalid merkle proof")]
    InvalidMerkleProof,
    #[msg("Commit has not expired yet")]
    CommitNotExpired,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Already renounced")]
    AlreadyRenounced,
    #[msg("Batch is not stale yet")]
    BatchNotStale,

    // Marketplace
    #[msg("Job amount below minimum (10 ECASH)")]
    JobBelowMinimum,
    #[msg("Deadline too short (minimum 1 hour)")]
    DeadlineTooShort,
    #[msg("Deadline too long (maximum 30 days)")]
    DeadlineTooLong,
    #[msg("Description cannot be empty")]
    EmptyDescription,
    #[msg("Description too long")]
    DescriptionTooLong,
    #[msg("Job is not open")]
    JobNotOpen,
    #[msg("Job is not accepted")]
    JobNotAccepted,
    #[msg("Job work not submitted")]
    JobNotSubmitted,
    #[msg("Cannot hire yourself")]
    CannotSelfHire,
    #[msg("Job deadline has passed")]
    DeadlinePassed,
    #[msg("Not the worker")]
    NotWorker,
    #[msg("Not the hirer")]
    NotHirer,
    #[msg("Not a party to this job")]
    NotParty,
    #[msg("Result cannot be empty")]
    EmptyResult,
    #[msg("Result too long")]
    ResultTooLong,
    #[msg("Job has not expired")]
    JobNotExpired,
    #[msg("Cannot reclaim this job")]
    CannotReclaim,
    #[msg("Not an arbitrator")]
    NotArbitrator,
    #[msg("Already voted")]
    AlreadyVoted,
    #[msg("Invalid vote")]
    InvalidVote,
    #[msg("Voting has ended")]
    VotingEnded,
    #[msg("Dispute already resolved")]
    DisputeAlreadyResolved,
    #[msg("Voting still open")]
    VotingStillOpen,
    #[msg("Too many arbitrators")]
    TooManyArbitrators,
    #[msg("Already assigned")]
    AlreadyAssigned,

    // Reputation
    #[msg("Must have 1+ puzzle solve")]
    NotVerified,
    #[msg("Name cannot be empty")]
    EmptyName,
    #[msg("Name too long")]
    NameTooLong,
    #[msg("Must be Silver tier (10+ solves)")]
    BelowSilverTier,
    #[msg("Already enrolled as arbitrator")]
    AlreadyEnrolledArbitrator,
    #[msg("Not enrolled as arbitrator")]
    NotEnrolledArbitrator,
    #[msg("Accuracy too low")]
    AccuracyTooLow,
    #[msg("Cannot arbitrate own dispute")]
    CannotArbitrateOwnDispute,
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

pub fn get_reward_amount(total_solved: u64) -> Result<u64> {
    if total_solved < ERA1_END {
        Ok(ERA1_REWARD)
    } else {
        Ok(ERA2_REWARD)
    }
}

pub fn get_burn_amount(total_solved: u64) -> Result<u64> {
    if total_solved < ERA1_END {
        Ok(ERA1_BURN)
    } else {
        Ok(ERA2_BURN)
    }
}

pub fn get_tier(solve_count: u64) -> Tier {
    if solve_count >= TIER_DIAMOND {
        Tier::Diamond
    } else if solve_count >= TIER_GOLD {
        Tier::Gold
    } else if solve_count >= TIER_SILVER {
        Tier::Silver
    } else if solve_count >= TIER_BRONZE {
        Tier::Bronze
    } else {
        Tier::Unranked
    }
}

pub fn is_accuracy_eligible(disputes_handled: u64, correct_votes: u64) -> bool {
    if disputes_handled == 0 {
        true
    } else {
        (correct_votes * 10000) / disputes_handled >= MIN_ARBITRATOR_ACCURACY_BPS
    }
}

pub fn normalize_answer(answer: &str) -> String {
    let lower = answer.to_lowercase();
    let filtered: String = lower
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == ' ')
        .collect();
    let trimmed = filtered.trim();
    let mut result = String::new();
    let mut last_was_space = false;
    for c in trimmed.chars() {
        if c == ' ' {
            if !last_was_space {
                result.push(c);
                last_was_space = true;
            }
        } else {
            result.push(c);
            last_was_space = false;
        }
    }
    result
}

pub fn compute_commit_hash(answer: &str, salt: &[u8; 32], secret: &[u8; 32], signer: &Pubkey) -> [u8; 32] {
    let mut input = Vec::new();
    input.extend_from_slice(answer.as_bytes());
    input.extend_from_slice(salt);
    input.extend_from_slice(secret);
    input.extend_from_slice(signer.as_ref());
    keccak::hash(&input).0
}

pub fn compute_merkle_leaf(puzzle_id: u64, normalized_answer: &str, salt: &[u8; 32]) -> Result<[u8; 32]> {
    let abi_encoded = abi_encode_puzzle_data(puzzle_id, normalized_answer, salt)?;
    let inner_hash = keccak::hash(&abi_encoded);
    let leaf_hash = keccak::hash(&inner_hash.0);
    Ok(leaf_hash.0)
}

fn abi_encode_puzzle_data(puzzle_id: u64, normalized_answer: &str, salt: &[u8; 32]) -> Result<Vec<u8>> {
    let mut encoded = Vec::new();

    let mut puzzle_id_bytes = [0u8; 32];
    puzzle_id_bytes[24..32].copy_from_slice(&puzzle_id.to_be_bytes());
    encoded.extend_from_slice(&puzzle_id_bytes);

    let mut offset_bytes = [0u8; 32];
    offset_bytes[31] = 0x60;
    encoded.extend_from_slice(&offset_bytes);

    encoded.extend_from_slice(salt);

    let string_bytes = normalized_answer.as_bytes();
    let string_len = string_bytes.len();
    let mut len_bytes = [0u8; 32];
    len_bytes[24..32].copy_from_slice(&(string_len as u64).to_be_bytes());
    encoded.extend_from_slice(&len_bytes);

    let padded_len = ((string_len + 31) / 32) * 32;
    let mut string_data = vec![0u8; padded_len.max(32)];
    string_data[..string_len].copy_from_slice(string_bytes);
    encoded.extend_from_slice(&string_data);

    Ok(encoded)
}

pub fn verify_merkle_proof(proof: &[[u8; 32]], root: &[u8; 32], leaf: &[u8; 32]) -> bool {
    let mut computed_hash = *leaf;
    for proof_element in proof.iter() {
        if computed_hash <= *proof_element {
            computed_hash = keccak::hashv(&[&computed_hash, proof_element]).0;
        } else {
            computed_hash = keccak::hashv(&[proof_element, &computed_hash]).0;
        }
    }
    computed_hash == *root
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_answer() {
        assert_eq!(normalize_answer("The Rosetta Stone"), "the rosetta stone");
        assert_eq!(normalize_answer("  HELLO   world  "), "hello world");
        assert_eq!(normalize_answer("café"), "caf");
        assert_eq!(normalize_answer("test-123!"), "test123");
    }

    #[test]
    fn test_get_tier() {
        assert_eq!(get_tier(0), Tier::Unranked);
        assert_eq!(get_tier(1), Tier::Bronze);
        assert_eq!(get_tier(10), Tier::Silver);
        assert_eq!(get_tier(25), Tier::Gold);
        assert_eq!(get_tier(50), Tier::Diamond);
    }

    #[test]
    fn test_is_accuracy_eligible() {
        assert!(is_accuracy_eligible(0, 0)); // new arbitrator
        assert!(is_accuracy_eligible(10, 6)); // 60%
        assert!(!is_accuracy_eligible(10, 5)); // 50%
    }
}
