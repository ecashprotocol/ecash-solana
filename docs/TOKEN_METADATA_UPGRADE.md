# Token-2022 Metadata Extension Upgrade Guide

**Purpose:** This document contains the code changes needed to create the Ecash mint with embedded Token-2022 metadata (name, symbol, uri) from day 1.

**Status:** NOT YET DEPLOYED - Save for next redeployment

## Overview

Token-2022's metadata extension allows embedding metadata directly in the mint account, eliminating the need for Metaplex. This requires:

1. Adding `MetadataPointer` extension when creating the mint
2. Calling `token_metadata_initialize` to set name/symbol/uri
3. Both must happen in the same transaction as mint creation

## Required Cargo.toml Changes

```toml
[dependencies]
anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.30.1", features = ["token", "associated_token"] }
solana-security-txt = "1.1.1"

# Token-2022 Metadata Extension
spl-token-metadata-interface = "0.3"
spl-type-length-value = "0.4"

# Force older versions to avoid edition2024 requirement
constant_time_eq = "=0.3.1"
blake3 = "=1.5.0"
```

## Required lib.rs Changes

### 1. Add Imports (at top of file)

```rust
use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{
    burn, mint_to, transfer_checked, Burn, Mint, MintTo, TokenAccount, TokenInterface,
    TransferChecked, token_metadata_initialize, TokenMetadataInitialize,
};
use spl_token_metadata_interface::state::TokenMetadata;
use spl_type_length_value::variable_len_pack::VariableLenPack;
```

### 2. Replace InitializeState Accounts Struct

```rust
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
    /// Note: We use init with extensions constraint
    #[account(
        init,
        payer = authority,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = mint,
        // NO freeze authority - this gives us "No Blacklist" on Rugcheck
        extensions::metadata_pointer::authority = authority,
        extensions::metadata_pointer::metadata_address = mint,
        seeds = [MINT_SEED],
        bump
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
```

### 3. Replace initialize_state Instruction

```rust
/// Initialize step 1: Create global state and mint with metadata
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

    // Token metadata constants
    let name = "Ecash".to_string();
    let symbol = "ECASH".to_string();
    let uri = "https://raw.githubusercontent.com/ecashprotocol/ecash-solana/main/token-metadata.json".to_string();

    // Calculate additional rent needed for metadata
    let token_metadata = TokenMetadata {
        name: name.clone(),
        symbol: symbol.clone(),
        uri: uri.clone(),
        update_authority: Some(ctx.accounts.authority.key()).try_into().unwrap(),
        mint: ctx.accounts.mint.key(),
        additional_metadata: vec![],
    };

    // Calculate space needed for metadata and transfer rent
    let data_len = 4 + token_metadata.get_packed_len().unwrap();
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

    // Initialize the token metadata
    // The mint PDA signs for itself since it's the mint authority
    let seeds = &[MINT_SEED, &[ctx.bumps.mint]];
    let signer_seeds = &[&seeds[..]];

    token_metadata_initialize(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TokenMetadataInitialize {
                token_program_id: ctx.accounts.token_program.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                metadata: ctx.accounts.mint.to_account_info(), // Same as mint for embedded metadata
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
```

## Alternative: Separate Metadata Instruction

If the above doesn't work due to Anchor constraints, use a two-step approach:

### Step 1: InitializeState (creates mint with metadata pointer only)

```rust
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

    #[account(
        init,
        payer = authority,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = mint,
        extensions::metadata_pointer::authority = authority,
        extensions::metadata_pointer::metadata_address = mint,
        seeds = [MINT_SEED],
        bump
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
```

### Step 2: InitializeMetadata (must be called immediately after)

```rust
#[derive(Accounts)]
pub struct InitializeMetadata<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
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

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_metadata(ctx: Context<InitializeMetadata>) -> Result<()> {
    let name = "Ecash".to_string();
    let symbol = "ECASH".to_string();
    let uri = "https://raw.githubusercontent.com/ecashprotocol/ecash-solana/main/token-metadata.json".to_string();

    // Calculate and transfer rent for metadata
    let token_metadata = TokenMetadata {
        name: name.clone(),
        symbol: symbol.clone(),
        uri: uri.clone(),
        update_authority: Some(ctx.accounts.authority.key()).try_into().unwrap(),
        mint: ctx.accounts.mint.key(),
        additional_metadata: vec![],
    };

    let data_len = 4 + token_metadata.get_packed_len().unwrap();
    let lamports_needed = Rent::get()?.minimum_balance(data_len);

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

    // Sign with mint PDA
    let seeds = &[MINT_SEED, &[ctx.accounts.global_state.mint_bump]];
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

    msg!("Token metadata initialized");
    Ok(())
}
```

## Testing Checklist

Before deploying:

1. [ ] Build with `cargo build-sbf` - verify no errors
2. [ ] Test on devnet first
3. [ ] Verify metadata shows on Solscan devnet
4. [ ] Verify freeze authority is None
5. [ ] Verify mint authority is the mint PDA
6. [ ] Test the full mining flow works

## Expected Token Properties on Solscan

After deployment with these changes:

| Property | Value |
|----------|-------|
| Name | Ecash |
| Symbol | ECASH |
| Image | (from URI JSON) |
| Freeze Authority | (not set) |
| Mint Authority | Mint PDA |
| Extensions | MetadataPointer, TokenMetadata |

## Resources

- [Solana Token Extensions Guide](https://solana.com/developers/guides/token-extensions/metadata-pointer)
- [Anchor Token Extensions Docs](https://www.anchor-lang.com/docs/tokens/extensions)
- [Blueshift Token-2022 Course](https://learn.blueshift.gg/en/courses/token-2022-with-anchor/metadata-extension)
- [spl-token-metadata-interface crate](https://crates.io/crates/spl-token-metadata-interface)

## Notes

1. The `extensions::metadata_pointer` constraint in Anchor automatically adds the MetadataPointer extension when initializing the mint.

2. The metadata pointer points to the mint itself (`metadata_address = mint`), meaning metadata is embedded in the mint account.

3. After `token_metadata_initialize`, the metadata is immutable unless you also set up an update authority and call update instructions.

4. This approach is superior to Metaplex for fungible tokens because:
   - No separate metadata account needed
   - No dependency on Metaplex program
   - Native Token-2022 support
   - Lower rent costs
