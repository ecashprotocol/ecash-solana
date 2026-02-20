use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PuzzleSolved {
    pub puzzle_id: u64,             // 8 bytes
    pub solver: Pubkey,             // 32 bytes
    pub solved_at: i64,             // 8 bytes
    pub bump: u8,                   // 1 byte
}
