use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct MinerState {
    pub owner: Pubkey,              // 32 bytes
    pub registered: bool,           // 1 byte
    pub gas_balance: u64,           // 8 bytes
    pub entered_batch: u64,         // 8 bytes
    pub has_pick: bool,             // 1 byte
    pub active_pick: u64,           // 8 bytes
    pub pick_timestamp: i64,        // 8 bytes
    pub has_commit: bool,           // 1 byte
    pub commit_hash: [u8; 32],      // 32 bytes
    pub commit_slot: u64,           // 8 bytes
    pub attempts: u8,               // 1 byte
    pub lockout_end: i64,           // 8 bytes
    pub last_solve_time: i64,       // 8 bytes
    pub solve_count: u64,           // 8 bytes
    pub last_regen_time: i64,       // 8 bytes
    pub referrer: Pubkey,           // 32 bytes
    pub bump: u8,                   // 1 byte
}
