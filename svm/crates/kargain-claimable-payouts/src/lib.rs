//! Claimable payouts — reachability-before-attempt (SPEC D-01 / §13.7a / D-04 / D-22 / D-23).
//!
//! Native lamport credits have no claim path. For SPL: classify the recipient
//! token account **before** any transfer CPI. Unreachable → move tokens to the
//! claim ATA and credit the claim record (no attempt to the recipient).
//! Reachable → transfer to the recipient (a failing CPI aborts the instruction —
//! correct, because reachability already said it should succeed).
//!
//! **Forbidden:** inspecting a transfer CPI `Err` to decide whether to claim
//! (attempt-then-catch). That branch is unreachable on Solana (§13.7a).

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_errors::KargainError;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

pub const CLAIM_SEED: &[u8] = b"claim";
pub const ESCROW_SEED: &[u8] = b"escrow";
/// Token account owned by the claim PDA (holds credited SPL until withdraw).
pub const CLAIM_ATA_SEED: &[u8] = b"claim-ata";
pub const CLAIM_ACCOUNT_DISCRIMINATOR: [u8; 8] = *b"kp_clm\0\0";

/// Classic SPL Token account size (Token-2022 base is the same first 165 bytes).
pub const SPL_TOKEN_ACCOUNT_LEN: usize = 165;
const SPL_TOKEN_ACCOUNT_MINT_OFFSET: usize = 0;
const SPL_TOKEN_ACCOUNT_STATE_OFFSET: usize = 108;

/// `AccountState` ordinals (spl-token).
pub const SPL_ACCOUNT_UNINITIALIZED: u8 = 0;
pub const SPL_ACCOUNT_INITIALIZED: u8 = 1;
pub const SPL_ACCOUNT_FROZEN: u8 = 2;

/// One claim PDA per `(recipient, mint)` — amount never inferred from lamports.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct ClaimAccount {
    pub discriminator: [u8; 8],
    pub recipient: [u8; 32],
    pub mint: [u8; 32],
    pub amount: u64,
    pub bump: u8,
}

impl ClaimAccount {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;

    pub fn new(recipient: [u8; 32], mint: [u8; 32], bump: u8) -> Self {
        Self {
            discriminator: CLAIM_ACCOUNT_DISCRIMINATOR,
            recipient,
            mint,
            amount: 0,
            bump,
        }
    }

    pub fn credit(&mut self, add: u64) -> Result<(), KargainError> {
        if add == 0 {
            return Ok(());
        }
        self.amount = self
            .amount
            .checked_add(add)
            .ok_or(KargainError::ArithmeticOverflow)?;
        Ok(())
    }
}

pub fn claim_pda(program_id: &Pubkey, recipient: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[CLAIM_SEED, recipient.as_ref(), mint.as_ref()],
        program_id,
    )
}

pub fn claim_ata_pda(program_id: &Pubkey, recipient: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[CLAIM_ATA_SEED, recipient.as_ref(), mint.as_ref()],
        program_id,
    )
}

pub fn escrow_pda(program_id: &Pubkey, consignment_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ESCROW_SEED, consignment_id], program_id)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PayoutEvent {
    ClaimRecorded {
        account: [u8; 32],
        asset: [u8; 32],
        amount: u64,
    },
    ClaimWithdrawn {
        account: [u8; 32],
        asset: [u8; 32],
        amount: u64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PayoutLeg {
    Platform,
    Seller,
    Agent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PayoutAuthorities {
    pub platform_recipient: [u8; 32],
    pub seller: [u8; 32],
    pub agent: [u8; 32],
}

pub fn verify_payout_recipient(
    leg: PayoutLeg,
    amount: u64,
    supplied: Option<&[u8; 32]>,
    authorities: &PayoutAuthorities,
) -> Result<(), KargainError> {
    if amount == 0 {
        return Ok(());
    }
    let expected = match leg {
        PayoutLeg::Platform => authorities.platform_recipient,
        PayoutLeg::Seller => authorities.seller,
        PayoutLeg::Agent => authorities.agent,
    };
    match supplied {
        None => Err(match leg {
            PayoutLeg::Platform => KargainError::MissingPlatformRecipient,
            PayoutLeg::Seller => KargainError::MissingSellerRecipient,
            PayoutLeg::Agent => KargainError::MissingAgentRecipient,
        }),
        Some(got) if *got == expected => Ok(()),
        Some(_) => Err(match leg {
            PayoutLeg::Platform => KargainError::WrongPlatformRecipient,
            PayoutLeg::Seller => KargainError::WrongSellerRecipient,
            PayoutLeg::Agent => KargainError::WrongAgentRecipient,
        }),
    }
}

/// Why an SPL receive to this account cannot be attempted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SplUnreachable {
    /// No account, empty data, or zero lamports with empty data.
    Absent,
    /// `AccountInfo::owner` is not the expected token program.
    WrongTokenProgram,
    /// Data shorter than classic token-account layout.
    BadLayout,
    /// `state == Uninitialized`.
    Uninitialized,
    /// Packed mint ≠ expected settlement mint.
    WrongMint,
    /// `state == Frozen` — spl-token refuses inbound transfer (measured: custom 0x11).
    Frozen,
}

/// Inbound transfer reachability (destination of a payout).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SplReceiveReachability {
    Reachable,
    Unreachable(SplUnreachable),
}

/// Classify whether a transfer **to** this token account can succeed.
///
/// Conditions (all must hold for [`SplReceiveReachability::Reachable`]):
/// 1. Account present with data
/// 2. Owning program == `token_program_id`
/// 3. Data length ≥ [`SPL_TOKEN_ACCOUNT_LEN`]
/// 4. `state == Initialized` only — `Frozen` refuses inbound transfer
///    (local-validator measured: Token program custom `0x11` / "Account is frozen")
/// 5. Packed mint == `expected_mint`
///
/// Does **not** inspect CPI results. Attempt-then-catch is forbidden (§13.7a / D-01).
pub fn classify_spl_receive_reachability(
    token_account: Option<&AccountInfo>,
    expected_mint: &Pubkey,
    token_program_id: &Pubkey,
) -> SplReceiveReachability {
    let Some(info) = token_account else {
        return SplReceiveReachability::Unreachable(SplUnreachable::Absent);
    };
    if info.data_is_empty() {
        return SplReceiveReachability::Unreachable(SplUnreachable::Absent);
    }
    if info.owner != token_program_id {
        return SplReceiveReachability::Unreachable(SplUnreachable::WrongTokenProgram);
    }
    let data = match info.try_borrow_data() {
        Ok(d) => d,
        Err(_) => {
            return SplReceiveReachability::Unreachable(SplUnreachable::BadLayout);
        }
    };
    classify_spl_receive_from_parts(true, true, &data, &expected_mint.to_bytes())
}

/// Pure classifier over raw bytes (unit tests / host without AccountInfo).
pub fn classify_spl_receive_from_parts(
    present: bool,
    owner_is_token_program: bool,
    data: &[u8],
    expected_mint: &[u8; 32],
) -> SplReceiveReachability {
    if !present || data.is_empty() {
        return SplReceiveReachability::Unreachable(SplUnreachable::Absent);
    }
    if !owner_is_token_program {
        return SplReceiveReachability::Unreachable(SplUnreachable::WrongTokenProgram);
    }
    if data.len() < SPL_TOKEN_ACCOUNT_LEN {
        return SplReceiveReachability::Unreachable(SplUnreachable::BadLayout);
    }
    let state = data[SPL_TOKEN_ACCOUNT_STATE_OFFSET];
    if state == SPL_ACCOUNT_UNINITIALIZED {
        return SplReceiveReachability::Unreachable(SplUnreachable::Uninitialized);
    }
    if state == SPL_ACCOUNT_FROZEN {
        return SplReceiveReachability::Unreachable(SplUnreachable::Frozen);
    }
    if state != SPL_ACCOUNT_INITIALIZED {
        return SplReceiveReachability::Unreachable(SplUnreachable::BadLayout);
    }
    let mint_bytes: [u8; 32] = data[SPL_TOKEN_ACCOUNT_MINT_OFFSET..SPL_TOKEN_ACCOUNT_MINT_OFFSET + 32]
        .try_into()
        .expect("slice len");
    if &mint_bytes != expected_mint {
        return SplReceiveReachability::Unreachable(SplUnreachable::WrongMint);
    }
    SplReceiveReachability::Reachable
}

const EXT_TRANSFER_FEE_CONFIG: u16 = 1;
const EXT_UNINITIALIZED: u16 = 0;
const MINT_SIZE_CLASSIC: usize = 82;
/// Token-2022 pads mint base to token-account length so AccountType sits at a fixed offset.
const TOKEN_2022_ACCOUNT_TYPE_OFFSET: usize = 165;
const TOKEN_2022_TLV_START: usize = 166;
const ACCOUNT_TYPE_MINT: u8 = 1;
/// Classic / Token-2022 mint layout: decimals at offset 44, `is_initialized` at 45.
const MINT_DECIMALS_OFFSET: usize = 44;
const MINT_INITIALIZED_OFFSET: usize = 45;

/// SPL Token program id (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`).
pub fn spl_token_program_id() -> Pubkey {
    Pubkey::new_from_array([
        6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133,
        237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
    ])
}

/// Token-2022 program id (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
pub fn spl_token_2022_program_id() -> Pubkey {
    Pubkey::new_from_array([
        6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26, 252,
        77, 131, 185, 13, 39, 254, 189, 249, 40, 216, 161, 139, 252,
    ])
}

/// Layout-only mint admission (no owner check). Prefer [`require_admitted_spl_mint_account`].
///
/// Classic Tokenkeg mint = exactly 82 bytes. Token-2022 with extensions:
/// `[0..82] mint · [82..165] zero pad · [165] AccountType=Mint · [166..] TLV`.
pub fn require_admitted_spl_mint(mint_data: &[u8]) -> Result<(), KargainError> {
    if mint_data.is_empty() {
        return Err(KargainError::TokenHasNoCode);
    }
    if mint_data.len() < MINT_SIZE_CLASSIC {
        return Err(KargainError::TokenNonConforming);
    }
    if mint_data.len() == MINT_SIZE_CLASSIC {
        return Ok(());
    }
    if mint_data.len() < TOKEN_2022_TLV_START {
        return Err(KargainError::TokenNonConforming);
    }
    if mint_data[TOKEN_2022_ACCOUNT_TYPE_OFFSET] != ACCOUNT_TYPE_MINT {
        return Err(KargainError::TokenNonConforming);
    }
    let mut i = TOKEN_2022_TLV_START;
    while i + 4 <= mint_data.len() {
        let type_id = u16::from_le_bytes([mint_data[i], mint_data[i + 1]]);
        let length = u16::from_le_bytes([mint_data[i + 2], mint_data[i + 3]]) as usize;
        if type_id == EXT_UNINITIALIZED {
            break;
        }
        if type_id == EXT_TRANSFER_FEE_CONFIG {
            return Err(KargainError::TransferFeeExtensionForbidden);
        }
        i = i
            .checked_add(4)
            .and_then(|x| x.checked_add(length))
            .ok_or(KargainError::TokenNonConforming)?;
    }
    Ok(())
}

/// Prove a mint account for payment admission: owning program, layout, no transfer-fee
/// extension, initialized, and return **decimals read from the mint** (never caller-supplied).
pub fn require_admitted_spl_mint_account(
    mint_owner: &Pubkey,
    mint_data: &[u8],
) -> Result<u8, KargainError> {
    if mint_owner != &spl_token_program_id() && mint_owner != &spl_token_2022_program_id() {
        return Err(KargainError::TokenNonConforming);
    }
    require_admitted_spl_mint(mint_data)?;
    if mint_data.len() <= MINT_INITIALIZED_OFFSET {
        return Err(KargainError::TokenDecimalsUnavailable);
    }
    if mint_data[MINT_INITIALIZED_OFFSET] != 1 {
        return Err(KargainError::TokenDecimalsUnavailable);
    }
    Ok(mint_data[MINT_DECIMALS_OFFSET])
}

pub fn require_full_delivery(before: u64, after: u64, expected: u64) -> Result<(), KargainError> {
    let got = after
        .checked_sub(before)
        .ok_or(KargainError::ShortDelivery)?;
    if got != expected {
        return Err(KargainError::ShortDelivery);
    }
    Ok(())
}

pub fn credit_claim(
    claim: &mut ClaimAccount,
    amount: u64,
) -> Result<Option<PayoutEvent>, KargainError> {
    if amount == 0 {
        return Ok(None);
    }
    claim.credit(amount)?;
    Ok(Some(PayoutEvent::ClaimRecorded {
        account: claim.recipient,
        asset: claim.mint,
        amount,
    }))
}

/// Route an SPL payout from a **pre-classified** reachability decision.
///
/// - [`SplReceiveReachability::Reachable`] → `pay_recipient()` only (no claim).
/// - [`SplReceiveReachability::Unreachable`] → `pay_claim_ata()` then credit claim.
///
/// Callers must classify with [`classify_spl_receive_reachability`] **before**
/// invoking either CPI path. Never pass a transfer's `Result` into this function.
pub fn pay_spl(
    claim: &mut ClaimAccount,
    amount: u64,
    reachability: SplReceiveReachability,
    pay_recipient: impl FnOnce() -> ProgramResult,
    pay_claim_ata: impl FnOnce() -> ProgramResult,
) -> Result<Option<PayoutEvent>, ProgramError> {
    if amount == 0 {
        return Ok(None);
    }
    match reachability {
        SplReceiveReachability::Reachable => {
            pay_recipient()?;
            Ok(None)
        }
        SplReceiveReachability::Unreachable(_) => {
            pay_claim_ata()?;
            credit_claim(claim, amount).map_err(into_program_error)
        }
    }
}

pub fn withdraw_claim_prepare(claim: &ClaimAccount) -> Result<u64, KargainError> {
    if claim.amount == 0 {
        return Err(KargainError::NoClaim);
    }
    Ok(claim.amount)
}

pub fn withdraw_claim_clear(claim: &mut ClaimAccount) -> PayoutEvent {
    let amount = claim.amount;
    let ev = PayoutEvent::ClaimWithdrawn {
        account: claim.recipient,
        asset: claim.mint,
        amount,
    };
    claim.amount = 0;
    ev
}

pub fn withdraw_claim(
    claim: &mut ClaimAccount,
    transfer: impl FnOnce(u64) -> ProgramResult,
) -> Result<PayoutEvent, ProgramError> {
    let amount = withdraw_claim_prepare(claim).map_err(into_program_error)?;
    transfer(amount)?;
    Ok(withdraw_claim_clear(claim))
}

fn into_program_error(e: KargainError) -> ProgramError {
    ProgramError::Custom(u32::from(e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_token_account(mint: [u8; 32], state: u8) -> Vec<u8> {
        let mut data = vec![0u8; SPL_TOKEN_ACCOUNT_LEN];
        data[SPL_TOKEN_ACCOUNT_MINT_OFFSET..SPL_TOKEN_ACCOUNT_MINT_OFFSET + 32]
            .copy_from_slice(&mint);
        data[SPL_TOKEN_ACCOUNT_STATE_OFFSET] = state;
        data
    }

    #[test]
    fn zero_leg_needs_no_account() {
        let auth = PayoutAuthorities {
            platform_recipient: [1u8; 32],
            seller: [2u8; 32],
            agent: [3u8; 32],
        };
        assert!(verify_payout_recipient(PayoutLeg::Agent, 0, None, &auth).is_ok());
    }

    #[test]
    fn missing_and_wrong_recipients() {
        let auth = PayoutAuthorities {
            platform_recipient: [1u8; 32],
            seller: [2u8; 32],
            agent: [3u8; 32],
        };
        assert_eq!(
            verify_payout_recipient(PayoutLeg::Platform, 1, None, &auth),
            Err(KargainError::MissingPlatformRecipient)
        );
        assert_eq!(
            verify_payout_recipient(PayoutLeg::Platform, 1, Some(&[9u8; 32]), &auth),
            Err(KargainError::WrongPlatformRecipient)
        );
        assert_eq!(
            verify_payout_recipient(PayoutLeg::Seller, 1, None, &auth),
            Err(KargainError::MissingSellerRecipient)
        );
        assert_eq!(
            verify_payout_recipient(PayoutLeg::Agent, 1, None, &auth),
            Err(KargainError::MissingAgentRecipient)
        );
    }

    #[test]
    fn reachability_absent_and_uninitialized() {
        let mint = [7u8; 32];
        assert_eq!(
            classify_spl_receive_from_parts(false, true, &[], &mint),
            SplReceiveReachability::Unreachable(SplUnreachable::Absent)
        );
        let data = blank_token_account(mint, SPL_ACCOUNT_UNINITIALIZED);
        assert_eq!(
            classify_spl_receive_from_parts(true, true, &data, &mint),
            SplReceiveReachability::Unreachable(SplUnreachable::Uninitialized)
        );
    }

    #[test]
    fn reachability_wrong_mint_and_program() {
        let mint = [7u8; 32];
        let data = blank_token_account([8u8; 32], SPL_ACCOUNT_INITIALIZED);
        assert_eq!(
            classify_spl_receive_from_parts(true, true, &data, &mint),
            SplReceiveReachability::Unreachable(SplUnreachable::WrongMint)
        );
        let ok_data = blank_token_account(mint, SPL_ACCOUNT_INITIALIZED);
        assert_eq!(
            classify_spl_receive_from_parts(true, false, &ok_data, &mint),
            SplReceiveReachability::Unreachable(SplUnreachable::WrongTokenProgram)
        );
    }

    #[test]
    fn reachability_initialized_ok_frozen_unreachable() {
        let mint = [7u8; 32];
        let init = blank_token_account(mint, SPL_ACCOUNT_INITIALIZED);
        assert_eq!(
            classify_spl_receive_from_parts(true, true, &init, &mint),
            SplReceiveReachability::Reachable
        );
        let frozen = blank_token_account(mint, SPL_ACCOUNT_FROZEN);
        assert_eq!(
            classify_spl_receive_from_parts(true, true, &frozen, &mint),
            SplReceiveReachability::Unreachable(SplUnreachable::Frozen)
        );
    }

    #[test]
    fn pay_spl_routes_unreachable_to_claim_without_recipient_cpi() {
        let mut c = ClaimAccount::new([1u8; 32], [2u8; 32], 0);
        let mut recipient_called = false;
        let ev = pay_spl(
            &mut c,
            100,
            SplReceiveReachability::Unreachable(SplUnreachable::Absent),
            || {
                recipient_called = true;
                Ok(())
            },
            || Ok(()),
        )
        .unwrap()
        .unwrap();
        assert!(!recipient_called);
        assert_eq!(c.amount, 100);
        assert_eq!(
            ev,
            PayoutEvent::ClaimRecorded {
                account: [1u8; 32],
                asset: [2u8; 32],
                amount: 100
            }
        );
    }

    #[test]
    fn pay_spl_reachable_never_credits_claim() {
        let mut c = ClaimAccount::new([1u8; 32], [2u8; 32], 0);
        let mut claim_paid = false;
        let ev = pay_spl(
            &mut c,
            100,
            SplReceiveReachability::Reachable,
            || Ok(()),
            || {
                claim_paid = true;
                Ok(())
            },
        )
        .unwrap();
        assert!(!claim_paid);
        assert!(ev.is_none());
        assert_eq!(c.amount, 0);
    }

    #[test]
    fn credit_overflow_named() {
        let mut c = ClaimAccount::new([1u8; 32], [2u8; 32], 0);
        c.amount = u64::MAX;
        assert_eq!(c.credit(1), Err(KargainError::ArithmeticOverflow));
    }

    #[test]
    fn withdraw_requires_claim() {
        let c = ClaimAccount::new([1u8; 32], [2u8; 32], 0);
        assert_eq!(withdraw_claim_prepare(&c), Err(KargainError::NoClaim));
    }

    #[test]
    fn withdraw_clears_only_after_transfer() {
        let mut c = ClaimAccount::new([1u8; 32], [2u8; 32], 0);
        c.credit(50).unwrap();
        assert!(withdraw_claim(&mut c, |_| Err(ProgramError::Custom(1))).is_err());
        assert_eq!(c.amount, 50);
        withdraw_claim(&mut c, |_| Ok(())).unwrap();
        assert_eq!(c.amount, 0);
    }

    #[test]
    fn short_delivery_named() {
        assert_eq!(
            require_full_delivery(10, 15, 6),
            Err(KargainError::ShortDelivery)
        );
    }

    /// Realistic Token-2022 mint: pad to 165, AccountType=Mint, then TLV.
    fn token_2022_mint_with_tlv(decimals: u8, tlv: &[(u16, &[u8])]) -> Vec<u8> {
        let mut data = classic_mint(decimals);
        data.resize(TOKEN_2022_ACCOUNT_TYPE_OFFSET, 0);
        data.push(ACCOUNT_TYPE_MINT);
        for &(type_id, payload) in tlv {
            data.extend_from_slice(&type_id.to_le_bytes());
            data.extend_from_slice(&(payload.len() as u16).to_le_bytes());
            data.extend_from_slice(payload);
        }
        data
    }

    #[test]
    fn transfer_fee_extension_forbidden() {
        let data = token_2022_mint_with_tlv(6, &[(EXT_TRANSFER_FEE_CONFIG, &[])]);
        assert_eq!(
            require_admitted_spl_mint(&data),
            Err(KargainError::TransferFeeExtensionForbidden)
        );
    }

    fn classic_mint(decimals: u8) -> Vec<u8> {
        let mut data = vec![0u8; MINT_SIZE_CLASSIC];
        data[MINT_DECIMALS_OFFSET] = decimals;
        data[MINT_INITIALIZED_OFFSET] = 1;
        data
    }

    #[test]
    fn admitted_mint_account_returns_decimals_from_bytes() {
        let data = classic_mint(6);
        assert_eq!(
            require_admitted_spl_mint_account(&spl_token_program_id(), &data),
            Ok(6)
        );
    }

    #[test]
    fn admitted_mint_account_refuses_wrong_owner() {
        assert_eq!(
            require_admitted_spl_mint_account(&Pubkey::new_from_array([9u8; 32]), &classic_mint(6)),
            Err(KargainError::TokenNonConforming)
        );
    }

    #[test]
    fn admitted_mint_account_refuses_transfer_fee_and_uninit() {
        let fee = token_2022_mint_with_tlv(6, &[(EXT_TRANSFER_FEE_CONFIG, &[0u8; 108])]);
        assert_eq!(
            require_admitted_spl_mint_account(&spl_token_2022_program_id(), &fee),
            Err(KargainError::TransferFeeExtensionForbidden)
        );
        let mut uninit = classic_mint(6);
        uninit[MINT_INITIALIZED_OFFSET] = 0;
        assert_eq!(
            require_admitted_spl_mint_account(&spl_token_program_id(), &uninit),
            Err(KargainError::TokenDecimalsUnavailable)
        );
    }

    #[test]
    fn short_extended_mint_without_tlv_region_refused() {
        let mut data = classic_mint(6);
        data.push(ACCOUNT_TYPE_MINT); // len 83 — not a valid Token-2022 extended mint
        assert_eq!(
            require_admitted_spl_mint(&data),
            Err(KargainError::TokenNonConforming)
        );
    }
}
