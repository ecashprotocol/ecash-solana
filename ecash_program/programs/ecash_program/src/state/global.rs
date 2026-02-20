use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    pub authority: Pubkey,          // 32 bytes
    pub mint: Pubkey,               // 32 bytes
    pub merkle_root: [u8; 32],      // 32 bytes
    pub total_solved: u64,          // 8 bytes
    pub current_batch: u64,         // 8 bytes
    pub batch_solve_count: u64,     // 8 bytes
    pub cooldown_end: i64,          // 8 bytes
    pub total_burned: u64,          // 8 bytes
    pub is_renounced: bool,         // 1 byte
    pub bump: u8,                   // 1 byte
    pub mint_bump: u8,              // 1 byte
    pub vault_bump: u8,             // 1 byte
    // Marketplace stats
    pub total_jobs_created: u64,    // 8 bytes
    pub total_jobs_completed: u64,  // 8 bytes
    pub total_disputes: u64,        // 8 bytes
    pub total_escrow_burned: u64,   // 8 bytes
    // Reputation stats
    pub total_agents_registered: u64, // 8 bytes
    pub total_arbitrators: u64,     // 8 bytes
}
