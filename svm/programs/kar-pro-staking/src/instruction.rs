use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum StakingIx {
    /// Authority initializes config and binds pass program (pair init).
    Initialize {
        pass_program: [u8; 32],
        min_stake_lamports: u64,
        min_stake_floor_lamports: u64,
        unbonding_period_secs: u64,
    },
    /// Stake SOL (`amount` lamports ≥ min), set active, CPI mint pass.
    Join {
        amount: u64,
        category: u8,
        name: String,
        metadata_uri: String,
    },
    /// End role immediately; start unbond; clear fee. No pass CPI.
    Leave,
    /// Claim after unlock_at.
    ClaimStake,
    /// Active verifier sets informational fee.
    SetVerificationFee { fee: u64 },
    /// Authority updates min stake (floor-gated).
    SetMinStakeNative { lamports: u64 },
    /// CPI close pass (separate from leave).
    ClosePass,
}
