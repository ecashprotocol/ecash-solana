use anchor_lang::prelude::*;

/// Job status enum
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum JobStatus {
    Open,           // Job posted, waiting for worker
    Accepted,       // Worker accepted, working
    WorkSubmitted,  // Work submitted, awaiting confirmation
    Completed,      // Confirmed and paid
    Cancelled,      // Cancelled or reclaimed
    Disputed,       // In dispute
    Resolved,       // Dispute resolved
}

impl Default for JobStatus {
    fn default() -> Self {
        JobStatus::Open
    }
}

/// Marketplace Job account
/// Seeds: ["job", job_id.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct Job {
    pub job_id: u64,                // 8 bytes - unique job identifier
    pub hirer: Pubkey,              // 32 bytes - who posted the job
    pub worker: Pubkey,             // 32 bytes - who accepted (default if none)
    pub amount: u64,                // 8 bytes - ECASH amount in escrow
    pub deadline: i64,              // 8 bytes - unix timestamp deadline
    pub created_at: i64,            // 8 bytes - when job was created
    pub accepted_at: i64,           // 8 bytes - when worker accepted
    pub submitted_at: i64,          // 8 bytes - when work was submitted
    pub completed_at: i64,          // 8 bytes - when job was completed/resolved
    pub status: JobStatus,          // 1 byte
    #[max_len(200)]
    pub description: String,        // 4 + 200 bytes - job description
    #[max_len(32)]
    pub result_hash: Vec<u8>,       // 4 + 32 bytes - hash of work result (stored off-chain)
    pub bump: u8,                   // 1 byte
}

/// Job escrow token account
/// Seeds: ["job_escrow", job_id.to_le_bytes()]
/// This is a token account that holds the ECASH for the job
/// Authority: the job_escrow PDA itself (self-custodied)
