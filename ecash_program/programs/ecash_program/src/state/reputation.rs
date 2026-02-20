use anchor_lang::prelude::*;

/// Tier levels based on puzzle solves
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Tier {
    Unranked,   // 0 solves
    Bronze,     // 1+ solves
    Silver,     // 10+ solves
    Gold,       // 25+ solves
    Diamond,    // 50+ solves
}

impl Default for Tier {
    fn default() -> Self {
        Tier::Unranked
    }
}

impl Tier {
    pub fn from_solve_count(count: u64) -> Self {
        if count >= 50 {
            Tier::Diamond
        } else if count >= 25 {
            Tier::Gold
        } else if count >= 10 {
            Tier::Silver
        } else if count >= 1 {
            Tier::Bronze
        } else {
            Tier::Unranked
        }
    }

    pub fn to_u8(&self) -> u8 {
        match self {
            Tier::Unranked => 0,
            Tier::Bronze => 1,
            Tier::Silver => 2,
            Tier::Gold => 3,
            Tier::Diamond => 4,
        }
    }
}

/// Agent profile for marketplace reputation
/// Seeds: ["agent_profile", owner.key()]
#[account]
#[derive(InitSpace)]
pub struct AgentProfile {
    pub owner: Pubkey,              // 32 bytes
    #[max_len(50)]
    pub name: String,               // 4 + 50 bytes
    #[max_len(200)]
    pub description: String,        // 4 + 200 bytes
    pub registered_at: i64,         // 8 bytes
    pub active: bool,               // 1 byte
    pub cached_solve_count: u64,    // 8 bytes - cached from MinerState
    pub cached_tier: Tier,          // 1 byte

    // Job stats as hirer
    pub jobs_posted: u64,           // 8 bytes
    pub jobs_completed_as_hirer: u64, // 8 bytes

    // Job stats as worker
    pub jobs_completed_as_worker: u64, // 8 bytes

    // Dispute stats
    pub disputes_as_party: u64,     // 8 bytes
    pub disputes_won: u64,          // 8 bytes
    pub disputes_lost: u64,         // 8 bytes

    pub bump: u8,                   // 1 byte
}

/// Arbitrator stats and enrollment
/// Seeds: ["arbitrator_stats", owner.key()]
#[account]
#[derive(InitSpace)]
pub struct ArbitratorStats {
    pub owner: Pubkey,              // 32 bytes
    pub enrolled: bool,             // 1 byte
    pub enrolled_at: i64,           // 8 bytes
    pub disputes_handled: u64,      // 8 bytes
    pub correct_votes: u64,         // 8 bytes
    pub total_earned: u64,          // 8 bytes - total ECASH earned from arbitration
    pub total_slashed: u64,         // 8 bytes - total ECASH lost from bad votes
    pub last_case_at: i64,          // 8 bytes
    pub bump: u8,                   // 1 byte
}

impl ArbitratorStats {
    /// Calculate accuracy rate in basis points (0-10000)
    pub fn accuracy_bps(&self) -> u64 {
        if self.disputes_handled == 0 {
            10000 // 100% for new arbitrators
        } else {
            (self.correct_votes * 10000) / self.disputes_handled
        }
    }

    /// Check if accuracy is above minimum (60% = 6000 bps)
    pub fn is_accuracy_eligible(&self) -> bool {
        self.accuracy_bps() >= 6000
    }
}

/// Arbitrator registry entry (for random selection)
/// Seeds: ["arbitrator_registry", index.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct ArbitratorRegistry {
    pub arbitrator: Pubkey,         // 32 bytes
    pub index: u64,                 // 8 bytes
    pub bump: u8,                   // 1 byte
}

/// Global arbitrator count tracker
/// Seeds: ["arbitrator_count"]
#[account]
#[derive(InitSpace)]
pub struct ArbitratorCount {
    pub count: u64,                 // 8 bytes
    pub bump: u8,                   // 1 byte
}
