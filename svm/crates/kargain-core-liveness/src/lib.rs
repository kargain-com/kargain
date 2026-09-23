//! Sole Core live-asset predicate (SPEC D-17).
//!
//! A Core account is live iff it is owned by mpl-core and longer than the
//! one-byte burn tombstone. Address law (passport `ASSET_SEED`, pass `PASS_SEED`)
//! stays in those owners — this crate never names a Kargain seed.
//!
//! Consumers: `kargain-passport-asset` (re-export) and `kar-pro-pass`.

use solana_program::account_info::AccountInfo;

/// Live Core asset (D-17): owned by Core with more than the 1-byte burn tombstone.
pub fn is_live_core_asset(asset: &AccountInfo) -> bool {
    asset.owner == &mpl_core::ID && asset.data_len() > 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::pubkey::Pubkey;

    fn account<'a>(
        key: &'a Pubkey,
        owner: &'a Pubkey,
        lamports: &'a mut u64,
        data: &'a mut [u8],
    ) -> AccountInfo<'a> {
        AccountInfo::new(key, false, false, lamports, data, owner, false, 0)
    }

    #[test]
    fn live_when_core_owned_and_longer_than_tombstone() {
        let key = Pubkey::new_from_array([1u8; 32]);
        let owner = mpl_core::ID;
        let mut lamports = 1u64;
        let mut data = [0u8; 2];
        let ai = account(&key, &owner, &mut lamports, &mut data);
        assert!(is_live_core_asset(&ai));
    }

    #[test]
    fn tombstone_is_not_live() {
        let key = Pubkey::new_from_array([1u8; 32]);
        let owner = mpl_core::ID;
        let mut lamports = 1u64;
        let mut data = [0u8; 1];
        let ai = account(&key, &owner, &mut lamports, &mut data);
        assert!(!is_live_core_asset(&ai));
    }

    #[test]
    fn empty_is_not_live() {
        let key = Pubkey::new_from_array([1u8; 32]);
        let owner = mpl_core::ID;
        let mut lamports = 1u64;
        let mut data: [u8; 0] = [];
        let ai = account(&key, &owner, &mut lamports, &mut data);
        assert!(!is_live_core_asset(&ai));
    }

    #[test]
    fn wrong_owner_is_not_live() {
        let key = Pubkey::new_from_array([1u8; 32]);
        let owner = Pubkey::new_from_array([9u8; 32]);
        let mut lamports = 1u64;
        let mut data = [0u8; 8];
        let ai = account(&key, &owner, &mut lamports, &mut data);
        assert!(!is_live_core_asset(&ai));
    }
}
