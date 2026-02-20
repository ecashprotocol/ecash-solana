use anchor_lang::prelude::*;

#[error_code]
pub enum ECashError {
    // Mining errors (0-99)
    #[msg("Already registered as miner")]
    AlreadyRegistered,
    #[msg("Not registered as miner")]
    NotRegistered,
    #[msg("Not enough gas to perform action")]
    NotEnoughGas,
    #[msg("Puzzle out of current batch range")]
    PuzzleOutOfBatchRange,
    #[msg("Already picked a puzzle")]
    AlreadyHasPick,
    #[msg("No active pick")]
    NoPick,
    #[msg("Already has commit")]
    AlreadyHasCommit,
    #[msg("No commit found")]
    NoCommit,
    #[msg("Commit hash mismatch")]
    CommitHashMismatch,
    #[msg("Invalid merkle proof")]
    InvalidMerkleProof,
    #[msg("Puzzle already solved")]
    PuzzleAlreadySolved,
    #[msg("Cannot reveal in same slot as commit")]
    SameSlotReveal,
    #[msg("Commit not expired yet")]
    CommitNotExpired,
    #[msg("Batch cooldown is active")]
    CooldownActive,
    #[msg("Pick has expired")]
    PickExpired,
    #[msg("Already entered current batch")]
    AlreadyEnteredBatch,
    #[msg("Batch is not stale")]
    BatchNotStale,
    #[msg("User is in lockout period")]
    InLockout,
    #[msg("Max attempts reached")]
    MaxAttemptsReached,
    #[msg("Mining has ended - all puzzles solved")]
    MiningEnded,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid referrer")]
    InvalidReferrer,
    #[msg("Pick puzzle ID mismatch")]
    PickMismatch,

    // Marketplace errors (100-199)
    #[msg("Job amount below minimum (10 ECASH)")]
    JobBelowMinimum,
    #[msg("Deadline too short (minimum 1 hour)")]
    DeadlineTooShort,
    #[msg("Deadline too long (maximum 30 days)")]
    DeadlineTooLong,
    #[msg("Description cannot be empty")]
    EmptyDescription,
    #[msg("Description too long (max 200 chars)")]
    DescriptionTooLong,
    #[msg("Job is not open")]
    JobNotOpen,
    #[msg("Job is not accepted")]
    JobNotAccepted,
    #[msg("Job work not submitted")]
    JobNotSubmitted,
    #[msg("Job not in disputed state")]
    JobNotDisputed,
    #[msg("Cannot hire yourself")]
    CannotSelfHire,
    #[msg("Job deadline has passed")]
    DeadlinePassed,
    #[msg("Not the worker for this job")]
    NotWorker,
    #[msg("Not the hirer for this job")]
    NotHirer,
    #[msg("Not a party to this job")]
    NotParty,
    #[msg("Work result cannot be empty")]
    EmptyResult,
    #[msg("Job has not expired yet")]
    JobNotExpired,
    #[msg("Cannot reclaim this job")]
    CannotReclaim,
    #[msg("Not enough arbitrators available")]
    NotEnoughArbitrators,
    #[msg("Not an assigned arbitrator")]
    NotArbitrator,
    #[msg("Already voted on this dispute")]
    AlreadyVoted,
    #[msg("Invalid vote value")]
    InvalidVote,
    #[msg("Voting period has ended")]
    VotingEnded,
    #[msg("Dispute already resolved")]
    DisputeAlreadyResolved,
    #[msg("Voting still open")]
    VotingStillOpen,
    #[msg("Job not found")]
    JobNotFound,

    // Reputation errors (200-299)
    #[msg("Profile already registered")]
    ProfileAlreadyRegistered,
    #[msg("Profile not registered")]
    ProfileNotRegistered,
    #[msg("Name too long (max 50 chars)")]
    NameTooLong,
    #[msg("Name cannot be empty")]
    EmptyName,
    #[msg("Must have at least 1 puzzle solve (Bronze tier)")]
    NotVerified,
    #[msg("Must be Silver tier or higher (10+ solves)")]
    BelowSilverTier,
    #[msg("Already enrolled as arbitrator")]
    AlreadyEnrolledArbitrator,
    #[msg("Not enrolled as arbitrator")]
    NotEnrolledArbitrator,
    #[msg("Accuracy too low to arbitrate")]
    AccuracyTooLow,
    #[msg("Cannot be arbitrator on own dispute")]
    CannotArbitrateOwnDispute,

    // General errors
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Invalid amount")]
    InvalidAmount,
}
