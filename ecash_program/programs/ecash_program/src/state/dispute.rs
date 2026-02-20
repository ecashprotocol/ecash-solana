use anchor_lang::prelude::*;

/// Vote options for arbitrators
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Vote {
    None,           // Not voted yet
    HirerWins,      // Vote for hirer
    WorkerWins,     // Vote for worker
}

impl Default for Vote {
    fn default() -> Self {
        Vote::None
    }
}

/// Dispute outcome
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum DisputeOutcome {
    Pending,        // Not resolved
    HirerWins,      // Hirer won
    WorkerWins,     // Worker won
}

impl Default for DisputeOutcome {
    fn default() -> Self {
        DisputeOutcome::Pending
    }
}

/// Dispute account for a job
/// Seeds: ["dispute", job_id.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct Dispute {
    pub job_id: u64,                // 8 bytes - reference to job
    pub disputer: Pubkey,           // 32 bytes - who filed the dispute
    pub dispute_fee: u64,           // 8 bytes - 5% dispute fee paid
    pub filed_at: i64,              // 8 bytes - when dispute was filed
    pub vote_deadline: i64,         // 8 bytes - deadline for votes

    // Arbitrators (up to 3 for tiebreaker)
    pub arbitrator_1: Pubkey,       // 32 bytes
    pub arbitrator_2: Pubkey,       // 32 bytes
    pub arbitrator_3: Pubkey,       // 32 bytes (default if not needed)

    // Votes
    pub vote_1: Vote,               // 1 byte
    pub vote_2: Vote,               // 1 byte
    pub vote_3: Vote,               // 1 byte

    // Stakes
    pub stake_1: u64,               // 8 bytes
    pub stake_2: u64,               // 8 bytes
    pub stake_3: u64,               // 8 bytes

    pub votes_received: u8,         // 1 byte
    pub arbitrator_count: u8,       // 1 byte (2 or 3)
    pub outcome: DisputeOutcome,    // 1 byte
    pub resolved: bool,             // 1 byte
    pub bump: u8,                   // 1 byte
}

/// Arbitrator stake escrow for a dispute
/// Seeds: ["dispute_stake", dispute.key(), arbitrator.key()]
/// Holds the 25 ECASH stake during dispute resolution
