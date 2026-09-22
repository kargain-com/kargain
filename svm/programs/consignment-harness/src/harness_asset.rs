//! Harness-only asset model (D-25 lab). Not used by commercial modes.
//!
//! Moved out of `kargain-consignment-base` in S8-E step 6 so FixedPrice/Ascending
//! cannot accidentally depend on HarnessAsset after Core migration.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_errors::KargainError;
use solana_program::pubkey::Pubkey;

pub const ASSET_SEED: &[u8] = b"harness-asset";
pub const ASSET_DISCRIMINATOR: [u8; 8] = *b"kp_ast\0\0";

/// Harness / mode asset: ownership is a real field move (not a delegate).
#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct HarnessAsset {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub owner: [u8; 32],
    /// TransferDelegate analogue — escrow approval carrier (D-09).
    pub approved_for: [u8; 32],
    pub bump: u8,
}

impl HarnessAsset {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1;
}

pub fn asset_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ASSET_SEED, token_id], program_id)
}

/// Lab open gate mirroring ConsignmentBase.sol:509–514 (harness flag path only).
pub fn require_can_open(
    self_encumbrance_registered: bool,
    may_open: bool,
    is_live: bool,
    escrow_approved: bool,
) -> Result<(), KargainError> {
    if !self_encumbrance_registered {
        return Err(KargainError::ModeNotEncumbranceSource);
    }
    if !may_open {
        return Err(KargainError::OpenConsignmentRefused);
    }
    if is_live {
        return Err(KargainError::LiveConsignment);
    }
    if !escrow_approved {
        return Err(KargainError::EscrowNotApproved);
    }
    Ok(())
}

pub fn is_escrow_approved(asset: &HarnessAsset, spender: &[u8; 32]) -> bool {
    asset.approved_for == *spender
}

pub fn take_custody(
    asset: &mut HarnessAsset,
    from: &[u8; 32],
    custody: &[u8; 32],
) -> Result<(), KargainError> {
    if asset.owner != *from {
        return Err(KargainError::NotPassportOwner);
    }
    asset.owner = *custody;
    asset.approved_for = [0u8; 32];
    Ok(())
}

pub fn release_custody(asset: &mut HarnessAsset, to: [u8; 32]) {
    asset.owner = to;
    asset.approved_for = [0u8; 32];
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn require_can_open_order() {
        assert_eq!(
            require_can_open(false, true, false, true),
            Err(KargainError::ModeNotEncumbranceSource)
        );
        assert_eq!(
            require_can_open(true, false, false, true),
            Err(KargainError::OpenConsignmentRefused)
        );
        assert_eq!(
            require_can_open(true, true, true, true),
            Err(KargainError::LiveConsignment)
        );
        assert_eq!(
            require_can_open(true, true, false, false),
            Err(KargainError::EscrowNotApproved)
        );
        assert!(require_can_open(true, true, false, true).is_ok());
    }

    #[test]
    fn take_release_moves_owner() {
        let seller = [1u8; 32];
        let custody = [2u8; 32];
        let mut asset = HarnessAsset {
            discriminator: ASSET_DISCRIMINATOR,
            token_id: [3u8; 32],
            owner: seller,
            approved_for: custody,
            bump: 1,
        };
        assert!(is_escrow_approved(&asset, &custody));
        take_custody(&mut asset, &seller, &custody).unwrap();
        assert_eq!(asset.owner, custody);
        assert_eq!(asset.approved_for, [0u8; 32]);
        release_custody(&mut asset, seller);
        assert_eq!(asset.owner, seller);
    }
}
