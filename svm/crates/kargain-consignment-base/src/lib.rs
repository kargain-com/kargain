//! Shared consignment automaton (Mandate + Recall + ConsignmentBase).
//!
//! Name / ordinal / check-order parity with:
//! - `contracts/lib/Mandate.sol`
//! - `contracts/lib/Recall.sol`
//! - `contracts/lib/ConsignmentBase.sol`
//!
//! Split arithmetic: sole owner `kargain-agented-split`.
//! Payout / claims: caller wires `kargain-claimable-payouts` (not duplicated here).

pub mod emit;

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_agented_split::{
    compute_agented_split, compute_direct_split, AgentedSplit, CompensationForm as SplitForm,
    BPS_DENOM,
};
use kargain_errors::KargainError;
use solana_program::pubkey::Pubkey;

pub const RECALL_COOLDOWN_SECS: u64 = 7 * 24 * 60 * 60; // 7 days — Recall.sol

pub const CONFIG_SEED: &[u8] = b"consign-config";
pub const CONSIGNMENT_SEED: &[u8] = b"consignment";
pub const MANDATE_SEED: &[u8] = b"mandate";
pub const RECALL_SEED: &[u8] = b"recall";
pub const ASSET_SEED: &[u8] = b"harness-asset";
pub const CUSTODY_SEED: &[u8] = b"custody";

pub const CONFIG_DISCRIMINATOR: [u8; 8] = *b"kp_cfg\0\0";
pub const CONSIGNMENT_DISCRIMINATOR: [u8; 8] = *b"kp_csg\0\0";
pub const MANDATE_DISCRIMINATOR: [u8; 8] = *b"kp_mdt\0\0";
pub const RECALL_DISCRIMINATOR: [u8; 8] = *b"kp_rcl\0\0";
pub const ASSET_DISCRIMINATOR: [u8; 8] = *b"kp_ast\0\0";

/// Phase ordinals match Solidity `ConsignmentBase.Phase`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Phase {
    None = 0,
    Offered = 1,
    Closed = 2,
    Returned = 3,
}

impl Phase {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::None),
            1 => Some(Self::Offered),
            2 => Some(Self::Closed),
            3 => Some(Self::Returned),
            _ => None,
        }
    }
}

/// CloseReason ordinals match Solidity `ConsignmentBase.CloseReason`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CloseReason {
    Returned = 0,
    Sold = 1,
    ExternalConfirmed = 2,
    HoldReleased = 3,
    Recalled = 4,
    ReversalCompleted = 5,
    ReversalAbandoned = 6,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DenominationKind {
    Asset = 0,
    Fiat = 1,
}

impl DenominationKind {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Asset),
            1 => Some(Self::Fiat),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CompensationForm {
    Margin = 0,
    Commission = 1,
}

impl CompensationForm {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Margin),
            1 => Some(Self::Commission),
            _ => None,
        }
    }
}

impl From<CompensationForm> for SplitForm {
    fn from(f: CompensationForm) -> Self {
        match f {
            CompensationForm::Margin => SplitForm::Margin,
            CompensationForm::Commission => SplitForm::Commission,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Denomination {
    pub kind: u8,
    pub currency_code: [u8; 32],
}

impl Denomination {
    pub fn kind_enum(&self) -> Option<DenominationKind> {
        DenominationKind::from_u8(self.kind)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Compensation {
    pub form: u8,
    pub commission_bps: u16,
}

impl Compensation {
    pub fn form_enum(&self) -> Option<CompensationForm> {
        CompensationForm::from_u8(self.form)
    }

    pub fn margin() -> Self {
        Self {
            form: CompensationForm::Margin as u8,
            commission_bps: 0,
        }
    }

    pub fn commission(bps: u16) -> Self {
        Self {
            form: CompensationForm::Commission as u8,
            commission_bps: bps,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct CommerceConfig {
    pub discriminator: [u8; 8],
    pub authority: [u8; 32],
    pub platform_recipient: [u8; 32],
    pub platform_fee_bps: u16,
    pub guardian: [u8; 32],
    pub paused: bool,
    pub self_encumbrance_registered: bool,
    pub bump: u8,
}

impl CommerceConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 2 + 32 + 1 + 1 + 1;

    pub fn new(
        authority: [u8; 32],
        platform_recipient: [u8; 32],
        platform_fee_bps: u16,
        guardian: [u8; 32],
        bump: u8,
    ) -> Result<Self, KargainError> {
        if platform_recipient == [0u8; 32] || guardian == [0u8; 32] {
            return Err(KargainError::ZeroAddress);
        }
        if u64::from(platform_fee_bps) > BPS_DENOM {
            return Err(KargainError::FeeTooHigh);
        }
        Ok(Self {
            discriminator: CONFIG_DISCRIMINATOR,
            authority,
            platform_recipient,
            platform_fee_bps,
            guardian,
            paused: false,
            self_encumbrance_registered: true,
            bump,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct ConsignmentRecord {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub seller: [u8; 32],
    pub agent: [u8; 32],
    pub asset: [u8; 32],
    pub denomination: Denomination,
    pub floor: u64,
    pub compensation: Compensation,
    pub platform_fee_bps: u16,
    pub price: u64,
    pub opened_at: u64,
    pub phase: u8,
    pub committed_not_offered: bool,
    pub bump: u8,
}

impl ConsignmentRecord {
    pub const SPACE: usize = 8 + 32 * 4 + 1 + 32 + 8 + 1 + 2 + 2 + 8 + 8 + 1 + 1 + 1;

    pub fn phase_enum(&self) -> Option<Phase> {
        Phase::from_u8(self.phase)
    }

    pub fn is_live(&self) -> bool {
        self.phase == Phase::Offered as u8
    }

    pub fn is_offered_actionable(&self) -> bool {
        self.phase == Phase::Offered as u8 && !self.committed_not_offered
    }

    pub fn is_offered_agented(&self) -> bool {
        self.is_offered_actionable() && self.agent != [0u8; 32]
    }
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct MandateRecord {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub agent: [u8; 32],
    pub expiry: u64,
    pub asset: [u8; 32],
    pub denomination: Denomination,
    pub floor: u64,
    pub compensation: Compensation,
    pub active: bool,
    pub bump: u8,
}

impl MandateRecord {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 32 + 1 + 32 + 8 + 1 + 2 + 1 + 1;
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct RecallRecord {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub requested_at: u64,
    pub bump: u8,
}

impl RecallRecord {
    pub const SPACE: usize = 8 + 32 + 8 + 1;
}

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SplitResult {
    pub platform: u64,
    pub owner_amount: u64,
    pub agent_amount: u64,
}

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

pub fn consignment_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONSIGNMENT_SEED, token_id], program_id)
}

pub fn mandate_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[MANDATE_SEED, token_id], program_id)
}

pub fn recall_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[RECALL_SEED, token_id], program_id)
}

pub fn asset_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ASSET_SEED, token_id], program_id)
}

pub fn custody_authority_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CUSTODY_SEED], program_id)
}

pub fn require_not_paused(cfg: &CommerceConfig) -> Result<(), KargainError> {
    if cfg.paused {
        return Err(KargainError::ContractPaused);
    }
    Ok(())
}

pub fn pause(cfg: &mut CommerceConfig, caller: &[u8; 32]) -> Result<(), KargainError> {
    if *caller != cfg.guardian {
        return Err(KargainError::NotGuardian);
    }
    cfg.paused = true;
    Ok(())
}

pub fn unpause(cfg: &mut CommerceConfig) {
    cfg.paused = false;
}

/// Owner-gated setGuardian — caller must be config authority (EVM onlyOwner).
pub fn set_guardian(
    cfg: &mut CommerceConfig,
    caller: &[u8; 32],
    new_guardian: [u8; 32],
) -> Result<[u8; 32], KargainError> {
    if *caller != cfg.authority {
        return Err(KargainError::NotGuardianOrOwner);
    }
    if new_guardian == [0u8; 32] {
        return Err(KargainError::ZeroAddress);
    }
    let previous = cfg.guardian;
    cfg.guardian = new_guardian;
    Ok(previous)
}

/// `_requireCanOpen` — exact order from ConsignmentBase.sol:509–514.
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

pub fn denomination_eq(a: &Denomination, b: &Denomination) -> bool {
    if a.kind != b.kind {
        return false;
    }
    if a.kind == DenominationKind::Asset as u8 {
        return true;
    }
    a.currency_code == b.currency_code
}

pub fn require_mandate_allows_open(
    m: &MandateRecord,
    open_denom: &Denomination,
    now: u64,
) -> Result<(), KargainError> {
    if !m.active {
        return Err(KargainError::NoMandate);
    }
    if m.expiry != 0 && now >= m.expiry {
        return Err(KargainError::MandateExpired);
    }
    if !denomination_eq(&m.denomination, open_denom) {
        return Err(KargainError::DenominationMismatch);
    }
    Ok(())
}

pub fn require_agented_price_meets_floor(
    price: u64,
    floor: u64,
    comp: Compensation,
    fee_bps: u16,
) -> Result<(), KargainError> {
    let form = comp.form_enum().ok_or(KargainError::InvalidStatus)?;
    let split = compute_agented_split(
        price,
        floor,
        SplitForm::from(form),
        comp.commission_bps,
        u64::from(fee_bps),
    )?;
    if !split.ok {
        return Err(KargainError::BelowFloor);
    }
    Ok(())
}

pub fn compute_split_for_lot(
    settled: u64,
    c: &ConsignmentRecord,
) -> Result<SplitResult, KargainError> {
    if c.agent == [0u8; 32] {
        let d = compute_direct_split(settled, u64::from(c.platform_fee_bps))?;
        return Ok(SplitResult {
            platform: d.platform,
            owner_amount: d.owner_amount,
            agent_amount: d.agent_amount,
        });
    }
    let form = c
        .compensation
        .form_enum()
        .ok_or(KargainError::InvalidStatus)?;
    let a: AgentedSplit = compute_agented_split(
        settled,
        c.floor,
        SplitForm::from(form),
        c.compensation.commission_bps,
        u64::from(c.platform_fee_bps),
    )?;
    if !a.ok {
        return Err(KargainError::BelowFloor);
    }
    Ok(SplitResult {
        platform: a.platform,
        owner_amount: a.owner_amount,
        agent_amount: a.agent_amount,
    })
}

pub fn write_open(
    token_id: [u8; 32],
    seller: [u8; 32],
    agent: [u8; 32],
    asset: [u8; 32],
    denomination: Denomination,
    floor: u64,
    compensation: Compensation,
    price: u64,
    fee_bps: u16,
    opened_at: u64,
    bump: u8,
) -> ConsignmentRecord {
    ConsignmentRecord {
        discriminator: CONSIGNMENT_DISCRIMINATOR,
        token_id,
        seller,
        agent,
        asset,
        denomination,
        floor,
        compensation,
        platform_fee_bps: fee_bps,
        price,
        opened_at,
        phase: Phase::Offered as u8,
        committed_not_offered: false,
        bump,
    }
}

pub fn require_offered_actionable(c: &ConsignmentRecord) -> Result<(), KargainError> {
    if !c.is_offered_actionable() {
        return Err(KargainError::NotOffered);
    }
    Ok(())
}

pub fn set_price(
    c: &mut ConsignmentRecord,
    caller: &[u8; 32],
    new_price: u64,
) -> Result<(), KargainError> {
    require_offered_actionable(c)?;
    if c.agent == [0u8; 32] {
        if c.seller != *caller {
            return Err(KargainError::NotConsignmentSeller);
        }
        c.price = new_price;
        return Ok(());
    }
    if c.agent != *caller {
        return Err(KargainError::NotConsignmentRunner);
    }
    require_agented_price_meets_floor(
        new_price,
        c.floor,
        c.compensation,
        c.platform_fee_bps,
    )?;
    c.price = new_price;
    Ok(())
}

pub fn lower_floor(
    c: &mut ConsignmentRecord,
    passport_owner: &[u8; 32],
    caller: &[u8; 32],
    new_floor: u64,
) -> Result<(), KargainError> {
    if passport_owner != caller {
        return Err(KargainError::NotPassportOwner);
    }
    if !c.is_live() {
        return Err(KargainError::NoLiveConsignment);
    }
    if new_floor >= c.floor {
        return Err(KargainError::CannotRaiseFloor);
    }
    c.floor = new_floor;
    Ok(())
}

/// Mode settle rewrite (e.g. FixedPrice fiat floor → asset units). Live only; no lower-only.
pub fn set_snapshot_floor(c: &mut ConsignmentRecord, floor: u64) -> Result<(), KargainError> {
    if !c.is_live() {
        return Err(KargainError::NoLiveConsignment);
    }
    c.floor = floor;
    Ok(())
}

pub fn lower_commission(
    c: &mut ConsignmentRecord,
    caller: &[u8; 32],
    new_bps: u16,
) -> Result<(), KargainError> {
    if !c.is_live() {
        return Err(KargainError::NoLiveConsignment);
    }
    if c.agent != *caller {
        return Err(KargainError::NotConsignmentAgent);
    }
    if c.compensation.form != CompensationForm::Commission as u8 {
        return Err(KargainError::NotCommissionForm);
    }
    if new_bps >= c.compensation.commission_bps {
        return Err(KargainError::CannotRaiseCommission);
    }
    c.compensation.commission_bps = new_bps;
    Ok(())
}

pub fn grant_mandate(
    token_id: [u8; 32],
    passport_owner: &[u8; 32],
    caller: &[u8; 32],
    is_live: bool,
    escrow_approved: bool,
    agent: [u8; 32],
    expiry: u64,
    asset: [u8; 32],
    denomination: Denomination,
    floor: u64,
    mut compensation: Compensation,
    bump: u8,
) -> Result<MandateRecord, KargainError> {
    if passport_owner != caller {
        return Err(KargainError::NotPassportOwner);
    }
    if is_live {
        return Err(KargainError::LiveConsignment);
    }
    if !escrow_approved {
        return Err(KargainError::EscrowNotApproved);
    }
    if agent == [0u8; 32] {
        return Err(KargainError::ZeroAddress);
    }
    if compensation.form == CompensationForm::Margin as u8 {
        compensation.commission_bps = 0;
    }
    Ok(MandateRecord {
        discriminator: MANDATE_DISCRIMINATOR,
        token_id,
        agent,
        expiry,
        asset,
        denomination,
        floor,
        compensation,
        active: true,
        bump,
    })
}

pub fn revoke_mandate(
    m: &MandateRecord,
    passport_owner: &[u8; 32],
    caller: &[u8; 32],
    is_live: bool,
) -> Result<[u8; 32], KargainError> {
    if passport_owner != caller {
        return Err(KargainError::NotPassportOwner);
    }
    if is_live {
        return Err(KargainError::LiveConsignment);
    }
    if !m.active {
        return Err(KargainError::NoMandate);
    }
    Ok(m.agent)
}

pub fn request_recall(
    c: &ConsignmentRecord,
    caller: &[u8; 32],
    already_requested: bool,
    now: u64,
) -> Result<u64, KargainError> {
    if !c.is_offered_agented() {
        return Err(KargainError::NotOfferedAgented);
    }
    if c.seller != *caller {
        return Err(KargainError::NotConsignmentSeller);
    }
    if already_requested {
        return Err(KargainError::ReturnAlreadyRequested);
    }
    Ok(now)
}

pub fn force_recall_ready(
    c: &ConsignmentRecord,
    caller: &[u8; 32],
    requested_at: u64,
    now: u64,
) -> Result<(), KargainError> {
    if !c.is_offered_agented() {
        return Err(KargainError::NotOfferedAgented);
    }
    if c.seller != *caller {
        return Err(KargainError::NotConsignmentSeller);
    }
    if requested_at == 0 {
        return Err(KargainError::ReturnNotRequested);
    }
    if now < requested_at.saturating_add(RECALL_COOLDOWN_SECS) {
        return Err(KargainError::ReturnCooldownPending);
    }
    Ok(())
}

pub fn owner_withdraw_ok(c: &ConsignmentRecord, caller: &[u8; 32]) -> Result<(), KargainError> {
    require_offered_actionable(c)?;
    if c.agent != [0u8; 32] {
        return Err(KargainError::NotDirectConsignment);
    }
    if c.seller != *caller {
        return Err(KargainError::NotConsignmentSeller);
    }
    Ok(())
}

pub fn agent_withdraw_ok(c: &ConsignmentRecord, caller: &[u8; 32]) -> Result<(), KargainError> {
    require_offered_actionable(c)?;
    if c.agent != *caller {
        return Err(KargainError::NotConsignmentAgent);
    }
    Ok(())
}

pub fn enter_committed_not_offered(c: &mut ConsignmentRecord) -> Result<(), KargainError> {
    require_offered_actionable(c)?;
    c.committed_not_offered = true;
    Ok(())
}

pub fn terminate_to_owner(c: &mut ConsignmentRecord, _reason: CloseReason) {
    c.committed_not_offered = false;
    c.phase = Phase::Returned as u8;
}

pub fn close_lot(c: &mut ConsignmentRecord, _reason: CloseReason) {
    c.committed_not_offered = false;
    c.phase = Phase::Closed as u8;
}

pub fn is_escrow_approved(asset: &HarnessAsset, spender: &[u8; 32]) -> bool {
    asset.approved_for == *spender
}

pub fn take_custody(asset: &mut HarnessAsset, from: &[u8; 32], custody: &[u8; 32]) -> Result<(), KargainError> {
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

/// Mode boundary: shared open signature refused (Ascending). Modes expose this
/// as a dedicated instruction body; shared crate keeps the name for parity.
pub fn refuse_shared_open_path() -> KargainError {
    KargainError::AscendingOpenPath
}

/// Mode boundary: setPrice refused (Ascending C4).
pub fn refuse_set_price_terms_fixed() -> KargainError {
    KargainError::TermsFixed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(n: u8) -> [u8; 32] {
        [n; 32]
    }

    fn margin() -> Compensation {
        Compensation::margin()
    }

    fn commission(bps: u16) -> Compensation {
        Compensation::commission(bps)
    }

    fn asset_denom() -> Denomination {
        Denomination {
            kind: DenominationKind::Asset as u8,
            currency_code: [0u8; 32],
        }
    }

    #[test]
    fn phase_and_close_reason_ordinals() {
        assert_eq!(Phase::None as u8, 0);
        assert_eq!(Phase::Offered as u8, 1);
        assert_eq!(Phase::Closed as u8, 2);
        assert_eq!(Phase::Returned as u8, 3);
        assert_eq!(CloseReason::Returned as u8, 0);
        assert_eq!(CloseReason::Sold as u8, 1);
        assert_eq!(CloseReason::Recalled as u8, 4);
        assert_eq!(CloseReason::ReversalAbandoned as u8, 6);
    }

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
    fn fee_too_high_and_zero_address_on_config() {
        assert_eq!(
            CommerceConfig::new(pk(1), [0u8; 32], 10, pk(2), 0),
            Err(KargainError::ZeroAddress)
        );
        assert_eq!(
            CommerceConfig::new(pk(1), pk(3), 10_001, pk(2), 0),
            Err(KargainError::FeeTooHigh)
        );
    }

    #[test]
    fn concessions_refuse_wrong_direction() {
        let mut c = write_open(
            pk(9),
            pk(1),
            pk(2),
            pk(3),
            asset_denom(),
            500,
            commission(200),
            1000,
            250,
            1,
            0,
        );
        assert_eq!(
            lower_floor(&mut c, &pk(1), &pk(1), 500),
            Err(KargainError::CannotRaiseFloor)
        );
        assert_eq!(
            lower_floor(&mut c, &pk(1), &pk(1), 600),
            Err(KargainError::CannotRaiseFloor)
        );
        assert!(lower_floor(&mut c, &pk(1), &pk(1), 400).is_ok());
        assert_eq!(c.floor, 400);

        assert_eq!(
            lower_commission(&mut c, &pk(2), 200),
            Err(KargainError::CannotRaiseCommission)
        );
        assert!(lower_commission(&mut c, &pk(2), 100).is_ok());
        assert_eq!(
            lower_commission(&mut c, &pk(2), 50),
            Ok(())
        );

        // D-27 settle rewrite — may raise or rewrite freely while live
        assert!(set_snapshot_floor(&mut c, 900).is_ok());
        assert_eq!(c.floor, 900);
        close_lot(&mut c, CloseReason::Sold);
        assert_eq!(
            set_snapshot_floor(&mut c, 1),
            Err(KargainError::NoLiveConsignment)
        );

        let mut margin_lot = write_open(
            pk(8),
            pk(1),
            pk(2),
            pk(3),
            asset_denom(),
            500,
            margin(),
            1000,
            250,
            1,
            0,
        );
        assert_eq!(
            lower_commission(&mut margin_lot, &pk(2), 0),
            Err(KargainError::NotCommissionForm)
        );
    }

    #[test]
    fn set_price_agented_below_floor() {
        let mut c = write_open(
            pk(9),
            pk(1),
            pk(2),
            pk(3),
            asset_denom(),
            900,
            margin(),
            1000,
            250,
            1,
            0,
        );
        // platform = 25 on 1000; headroom 975; floor 900 ok at 1000
        assert!(set_price(&mut c, &pk(2), 1000).is_ok());
        // too low
        assert_eq!(
            set_price(&mut c, &pk(2), 100),
            Err(KargainError::BelowFloor)
        );
        assert_eq!(
            set_price(&mut c, &pk(1), 1000),
            Err(KargainError::NotConsignmentRunner)
        );
    }

    #[test]
    fn recall_cooldown_and_rc1() {
        let mut c = write_open(
            pk(9),
            pk(1),
            pk(2),
            pk(3),
            asset_denom(),
            500,
            margin(),
            1000,
            250,
            1,
            0,
        );
        let t0 = 1_000_000u64;
        let requested = request_recall(&c, &pk(1), false, t0).unwrap();
        assert_eq!(
            force_recall_ready(&c, &pk(1), requested, t0 + 1),
            Err(KargainError::ReturnCooldownPending)
        );
        assert!(force_recall_ready(&c, &pk(1), requested, t0 + RECALL_COOLDOWN_SECS).is_ok());

        enter_committed_not_offered(&mut c).unwrap();
        assert!(c.is_live());
        assert!(!c.is_offered_actionable());
        assert_eq!(
            request_recall(&c, &pk(1), false, t0),
            Err(KargainError::NotOfferedAgented)
        );
    }

    #[test]
    fn custody_is_owner_move_not_delegate() {
        let custody = pk(99);
        let seller = pk(1);
        let mut asset = HarnessAsset {
            discriminator: ASSET_DISCRIMINATOR,
            token_id: pk(9),
            owner: seller,
            approved_for: custody, // approve first
            bump: 0,
        };
        assert!(is_escrow_approved(&asset, &custody));
        take_custody(&mut asset, &seller, &custody).unwrap();
        assert_eq!(asset.owner, custody);
        assert_eq!(asset.approved_for, [0u8; 32]);
        release_custody(&mut asset, seller);
        assert_eq!(asset.owner, seller);
    }

    #[test]
    fn split_uses_lot_fee_snapshot() {
        let c = write_open(
            pk(9),
            pk(1),
            [0u8; 32],
            [0u8; 32],
            asset_denom(),
            0,
            margin(),
            1000,
            250, // snapshotted
            1,
            0,
        );
        let s = compute_split_for_lot(1000, &c).unwrap();
        assert_eq!(s.platform, 25);
        assert_eq!(s.owner_amount, 975);
        assert_eq!(s.agent_amount, 0);
    }

    #[test]
    fn mode_boundary_refusals_named() {
        assert_eq!(refuse_shared_open_path(), KargainError::AscendingOpenPath);
        assert_eq!(refuse_set_price_terms_fixed(), KargainError::TermsFixed);
    }

    #[test]
    fn withdraw_paths() {
        let direct = write_open(
            pk(9),
            pk(1),
            [0u8; 32],
            pk(3),
            asset_denom(),
            0,
            margin(),
            100,
            10,
            1,
            0,
        );
        assert!(owner_withdraw_ok(&direct, &pk(1)).is_ok());
        assert_eq!(
            owner_withdraw_ok(&direct, &pk(2)),
            Err(KargainError::NotConsignmentSeller)
        );

        let agented = write_open(
            pk(8),
            pk(1),
            pk(2),
            pk(3),
            asset_denom(),
            50,
            margin(),
            100,
            10,
            1,
            0,
        );
        assert_eq!(
            owner_withdraw_ok(&agented, &pk(1)),
            Err(KargainError::NotDirectConsignment)
        );
        assert!(agent_withdraw_ok(&agented, &pk(2)).is_ok());
    }
}
