use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum PassIx {
    /// Authority initializes config + binds staking program.
    Initialize { staking_program: [u8; 32] },
    /// Staking-only: mint soulbound Core pass + meta for holder.
    Mint {
        category: u8,
        name: String,
        metadata_uri: String,
    },
    /// Staking-only: thaw + burn Core asset and close meta (leave never calls this).
    ClosePass { holder: [u8; 32] },
}
