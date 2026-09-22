//! Ascending mode — asset denomination only (S6 #4 / S8-E step 6 / 6c).
//!
//! Custody = Core passport TransferV1 via `kargain-consignment-base::core_custody`.
//! Trust = passport `resolve_may_accounts` + registry; open requires Verified status.
//! Obligation answers mirror EVM Ascending `may`: created at Settle (`open_obligation`),
//! closed with refund on hold-clear (`close_obligation`) — sole owner `kargain-encumbrance`.
//! Harness CreateAsset / ApproveEscrow / SetMayOpen / SetVerified / SetSelfEncumbrance /
//! ForceAssetOwner refuse with `HarnessInstructionRetired`.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_agented_split::BPS_DENOM;
use kargain_bonded_challenge::{
    challenge_pda, conclude_challenge, judge_challenge, open_challenge, transfer_bond_lamports,
    withdraw_challenge, ChallengeAccount, ChallengeConfig, ChallengeHooks, JudgeOutcome,
    CHALLENGE_SEED,
    emit::{emit_challenge, ChallengeEmitter},
};
use kargain_claimable_payouts::{
    claim_ata_pda, claim_pda, classify_spl_receive_reachability, escrow_pda, pay_spl,
    require_admitted_spl_mint_account, require_full_delivery, spl_close_account_ix,
    spl_token_account_amount, withdraw_claim, ClaimAccount, CLAIM_ATA_SEED, CLAIM_SEED, ESCROW_SEED,
    SPL_TOKEN_ACCOUNT_LEN, PayoutAuthorities, PayoutLeg, SplReceiveReachability,
    verify_payout_recipient,
    emit::{emit_payout, PayoutEmitter},
};
use kargain_consignment_base::{
    close_lot, compute_split_for_lot, config_pda, consignment_account_is_live, consignment_pda,
    core_asset_owner, custody_authority_pda, enter_committed_not_offered, grant_mandate, mandate_pda,
    passport_binding_pda, pause, refuse_set_price_terms_fixed, refuse_shared_open_path,
    require_agented_price_meets_floor, require_binding_uninitialised, require_bound_passport_program,
    require_config_authority, require_mandate_allows_open, require_not_paused,
    require_passport_core_asset, has_transfer_delegate, require_transfer_delegate, revoke_mandate, terminate_to_owner,
    transfer_custody_to_recipient, transfer_delegate_to_custody, transfer_owner_to_custody,
    transfer_owner_to_recipient, unpause, write_open, CloseReason, CommerceConfig, Compensation,
    CompensationForm, CONFIG_DISCRIMINATOR, ConsignmentRecord, Denomination, DenominationKind,
    MandateRecord, PassportBinding, Phase, CONFIG_SEED, CONSIGNMENT_SEED, MANDATE_SEED,
    PASSPORT_BINDING_SEED,
    emit::{
        emit_commerce, event_closed, event_mandate_granted, event_opened, event_split_paid,
        CommerceEmitter, ConsignmentEvent,
    },
};
use kargain_encumbrance::{
    close_obligation, open_obligation,
    INTENT_OPEN_CONSIGNMENT,
};
use kargain_errors::KargainError;
use kargain_events::generated;
use kar_passport::may::{
    encumbrance_seed_prefix_for_source, require_verified_passport_status, resolve_may_accounts,
};
use kar_pro_staking::prove_active_verifier;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

// ---- Model constants (SPEC §I.13.10 / AscendingConsignment) ----

pub const MIN_DURATION: u64 = 3 * 24 * 60 * 60;
pub const MAX_DURATION: u64 = 30 * 24 * 60 * 60;
pub const EXTENSION_WINDOW: u64 = 900;
pub const MIN_INCREMENT_BPS: u16 = 300;
pub const MIN_PROTECTION_WINDOW: u64 = 7 * 24 * 60 * 60;
pub const MAX_PROTECTION_WINDOW: u64 = 45 * 24 * 60 * 60;
pub const ABANDONMENT_WINDOW: u64 = 30 * 24 * 60 * 60;

pub const AUCTION_SEED: &[u8] = b"auction";
pub const HOLD_SEED: &[u8] = b"hold";
pub const PAYMENT_TOKEN_SEED: &[u8] = b"payment-token";

pub const ASC_CONFIG_DISC: [u8; 8] = *b"kp_ascfg";
pub const AUCTION_DISC: [u8; 8] = *b"kp_auct\0";
pub const HOLD_DISC: [u8; 8] = *b"kp_hold\0";
pub const PAYMENT_TOKEN_DISC: [u8; 8] = *b"kp_aptk\0";

const COMMERCE_EMITTER: CommerceEmitter = CommerceEmitter::AscendingConsignment;
const CHALLENGE_EMITTER: ChallengeEmitter = ChallengeEmitter::AscendingConsignment;

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum AscendingIx {
    /// Accounts: payer · config · authority · platform · guardian · forfeit · system
    InitConfig {
        platform_fee_bps: u16,
        challenge_bond: u64,
        challenge_window: u64,
        staking_program: [u8; 32],
    },
    /// Retired — refuses with `HarnessInstructionRetired`.
    CreateAsset { token_id: [u8; 32] },
    /// Retired — refuses with `HarnessInstructionRetired`.
    ApproveEscrow { token_id: [u8; 32] },
    /// Retired — refuses with `HarnessInstructionRetired`.
    SetMayOpen { token_id: [u8; 32], allowed: bool },
    /// Retired — refuses with `HarnessInstructionRetired`.
    SetVerified { token_id: [u8; 32], verified: bool },
    /// Retired — refuses with `HarnessInstructionRetired`.
    SetSelfEncumbrance { registered: bool },
    Grant {
        token_id: [u8; 32],
        agent: [u8; 32],
        expiry: u64,
        asset_mint: [u8; 32],
        denom_kind: u8,
        currency_code: [u8; 32],
        floor: u64,
        form: u8,
        commission_bps: u16,
    },
    Revoke { token_id: [u8; 32] },
    /// Shared open signature — always `AscendingOpenPath`.
    OpenDirect {
        token_id: [u8; 32],
        asset_mint: [u8; 32],
        denom_kind: u8,
        currency_code: [u8; 32],
        price: u64,
    },
    OpenFromMandate {
        token_id: [u8; 32],
        denom_kind: u8,
        currency_code: [u8; 32],
        price: u64,
    },
    /// C4 — always `TermsFixed`.
    SetPrice { token_id: [u8; 32], new_price: u64 },
    OpenAscendingDirect {
        token_id: [u8; 32],
        asset_mint: [u8; 32],
        reserve: u64,
        duration: u64,
        protection_window: u64,
    },
    OpenAscendingFromMandate {
        token_id: [u8; 32],
        reserve: u64,
        duration: u64,
        protection_window: u64,
    },
    Bid { token_id: [u8; 32], amount: u64 },
    Settle { token_id: [u8; 32] },
    ConfirmReceipt { token_id: [u8; 32] },
    ReleaseFunds { token_id: [u8; 32] },
    CompleteReversal { token_id: [u8; 32] },
    AbandonReversal { token_id: [u8; 32] },
    OpenChallenge { token_id: [u8; 32] },
    WithdrawChallenge { token_id: [u8; 32] },
    JudgeChallenge { token_id: [u8; 32], outcome: u8 },
    ConcludeChallenge { token_id: [u8; 32] },
    ApprovePaymentToken,
    RevokePaymentToken { mint: [u8; 32] },
    Pause,
    Unpause,
    SetChallengeBond { challenge_bond: u64 },
    WithdrawClaim,
    ForceAuctionEndsAt { token_id: [u8; 32], ends_at: u64 },
    ForceHoldClock {
        token_id: [u8; 32],
        protection_ends_at: u64,
        frozen_remaining: u64,
        abandonment_deadline: u64,
    },
    /// Retired — refuses with `HarnessInstructionRetired`.
    ForceAssetOwner { token_id: [u8; 32], owner: [u8; 32] },
    /// One-shot bind of passport program id into mode PDA.
    /// Accounts: authority(signer) · config · binding · passport_program(executable) · system · payer
    BindPassportProgram,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct AscendingConfig {
    pub discriminator: [u8; 8],
    pub authority: [u8; 32],
    pub platform_recipient: [u8; 32],
    pub platform_fee_bps: u16,
    pub guardian: [u8; 32],
    pub paused: bool,
    pub self_encumbrance_registered_retired: bool,
    pub staking_program: [u8; 32],
    pub forfeit_recipient: [u8; 32],
    pub challenge_bond: u64,
    pub challenge_window: u64,
    pub challenge_configured: bool,
    pub bump: u8,
}

impl AscendingConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 2 + 32 + 1 + 1 + 32 + 32 + 8 + 8 + 1 + 1;

    pub fn as_commerce_config(&self) -> CommerceConfig {
        CommerceConfig {
            discriminator: CONFIG_DISCRIMINATOR,
            authority: self.authority,
            platform_recipient: self.platform_recipient,
            platform_fee_bps: self.platform_fee_bps,
            guardian: self.guardian,
            paused: self.paused,
            self_encumbrance_registered_retired: self.self_encumbrance_registered_retired,
            bump: self.bump,
        }
    }

    pub fn challenge_config(&self) -> ChallengeConfig {
        ChallengeConfig {
            forfeit_recipient: self.forfeit_recipient,
            window_duration: self.challenge_window,
            configured: self.challenge_configured,
        }
    }
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct AuctionTermsRecord {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub duration: u64,
    pub ends_at: u64,
    pub extension_window: u64,
    pub protection_window: u64,
    pub abandonment_window: u64,
    pub min_increment_bps: u16,
    pub highest_bidder: [u8; 32],
    pub highest_bid: u64,
    pub bump: u8,
}

impl AuctionTermsRecord {
    pub const SPACE: usize = 8 + 32 + 8 * 5 + 2 + 32 + 8 + 1;
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct HoldRecord {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub buyer: [u8; 32],
    pub gross: u64,
    pub protection_ends_at: u64,
    pub frozen_remaining: u64,
    pub reversal_pending: bool,
    pub abandonment_deadline: u64,
    pub abandonment_window: u64,
    pub bump: u8,
}

impl HoldRecord {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 8 + 8 + 1;

    pub fn is_active(&self) -> bool {
        self.buyer != [0u8; 32]
    }

    pub fn clear(&mut self) {
        self.buyer = [0u8; 32];
        self.gross = 0;
        self.protection_ends_at = 0;
        self.frozen_remaining = 0;
        self.reversal_pending = false;
        self.abandonment_deadline = 0;
        self.abandonment_window = 0;
    }
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct PaymentTokenRecord {
    pub discriminator: [u8; 8],
    pub mint: [u8; 32],
    pub enabled: bool,
    pub decimals: u8,
    pub bump: u8,
}

impl PaymentTokenRecord {
    pub const SPACE: usize = 8 + 32 + 1 + 1 + 1;
}

pub fn auction_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[AUCTION_SEED, token_id], program_id)
}

pub fn hold_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[HOLD_SEED, token_id], program_id)
}

pub fn payment_token_pda(program_id: &Pubkey, mint: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PAYMENT_TOKEN_SEED, mint], program_id)
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let ix = AscendingIx::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        AscendingIx::InitConfig {
            platform_fee_bps,
            challenge_bond,
            challenge_window,
            staking_program,
        } => init_config(
            program_id,
            accounts,
            platform_fee_bps,
            challenge_bond,
            challenge_window,
            staking_program,
        ),
        AscendingIx::CreateAsset { token_id } => create_asset(program_id, accounts, token_id),
        AscendingIx::ApproveEscrow { token_id } => approve_escrow(program_id, accounts, token_id),
        AscendingIx::SetMayOpen { token_id, allowed } => {
            set_may_open(program_id, accounts, token_id, allowed)
        }
        AscendingIx::SetVerified { token_id, verified } => {
            set_verified(program_id, accounts, token_id, verified)
        }
        AscendingIx::SetSelfEncumbrance { registered } => {
            set_self_enc(program_id, accounts, registered)
        }
        AscendingIx::Grant {
            token_id,
            agent,
            expiry,
            asset_mint,
            denom_kind,
            currency_code,
            floor,
            form,
            commission_bps,
        } => grant(
            program_id,
            accounts,
            token_id,
            agent,
            expiry,
            asset_mint,
            denom_kind,
            currency_code,
            floor,
            form,
            commission_bps,
        ),
        AscendingIx::Revoke { token_id } => revoke(program_id, accounts, token_id),
        AscendingIx::OpenDirect { .. } | AscendingIx::OpenFromMandate { .. } => {
            Err(into_pe(refuse_shared_open_path()))
        }
        AscendingIx::SetPrice { .. } => Err(into_pe(refuse_set_price_terms_fixed())),
        AscendingIx::OpenAscendingDirect {
            token_id,
            asset_mint,
            reserve,
            duration,
            protection_window,
        } => open_ascending_direct(
            program_id,
            accounts,
            token_id,
            asset_mint,
            reserve,
            duration,
            protection_window,
        ),
        AscendingIx::OpenAscendingFromMandate {
            token_id,
            reserve,
            duration,
            protection_window,
        } => open_ascending_from_mandate(
            program_id,
            accounts,
            token_id,
            reserve,
            duration,
            protection_window,
        ),
        AscendingIx::Bid { token_id, amount } => bid(program_id, accounts, token_id, amount),
        AscendingIx::Settle { token_id } => settle(program_id, accounts, token_id),
        AscendingIx::ConfirmReceipt { token_id } => {
            confirm_receipt(program_id, accounts, token_id)
        }
        AscendingIx::ReleaseFunds { token_id } => release_funds(program_id, accounts, token_id),
        AscendingIx::CompleteReversal { token_id } => {
            complete_reversal(program_id, accounts, token_id)
        }
        AscendingIx::AbandonReversal { token_id } => {
            abandon_reversal(program_id, accounts, token_id)
        }
        AscendingIx::OpenChallenge { token_id } => open_challenge_ix(program_id, accounts, token_id),
        AscendingIx::WithdrawChallenge { token_id } => {
            withdraw_challenge_ix(program_id, accounts, token_id)
        }
        AscendingIx::JudgeChallenge { token_id, outcome } => {
            judge_challenge_ix(program_id, accounts, token_id, outcome)
        }
        AscendingIx::ConcludeChallenge { token_id } => {
            conclude_challenge_ix(program_id, accounts, token_id)
        }
        AscendingIx::ApprovePaymentToken => approve_payment_token(program_id, accounts),
        AscendingIx::RevokePaymentToken { mint } => {
            revoke_payment_token(program_id, accounts, mint)
        }
        AscendingIx::Pause => pause_ix(program_id, accounts),
        AscendingIx::Unpause => unpause_ix(program_id, accounts),
        AscendingIx::SetChallengeBond { challenge_bond } => {
            set_challenge_bond(program_id, accounts, challenge_bond)
        }
        AscendingIx::WithdrawClaim => withdraw_claim_ix(program_id, accounts),
        AscendingIx::ForceAuctionEndsAt { token_id, ends_at } => {
            force_auction_ends_at(program_id, accounts, token_id, ends_at)
        }
        AscendingIx::ForceHoldClock {
            token_id,
            protection_ends_at,
            frozen_remaining,
            abandonment_deadline,
        } => force_hold_clock(
            program_id,
            accounts,
            token_id,
            protection_ends_at,
            frozen_remaining,
            abandonment_deadline,
        ),
        AscendingIx::ForceAssetOwner { token_id, owner } => {
            force_asset_owner(program_id, accounts, token_id, owner)
        }
        AscendingIx::BindPassportProgram => bind_passport_program(program_id, accounts),
    }
}

fn into_pe(e: KargainError) -> ProgramError {
    ProgramError::Custom(u32::from(e))
}

fn load_asc_config(info: &AccountInfo) -> Result<AscendingConfig, ProgramError> {
    AscendingConfig::try_from_slice(&info.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)
}

fn save_asc_config(info: &AccountInfo, cfg: &AscendingConfig) -> ProgramResult {
    let mut data = info.try_borrow_mut_data()?;
    cfg.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}

fn load_consignment(info: &AccountInfo) -> Result<ConsignmentRecord, ProgramError> {
    ConsignmentRecord::try_from_slice(&info.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)
}

fn save_consignment(info: &AccountInfo, c: &ConsignmentRecord) -> ProgramResult {
    let mut data = info.try_borrow_mut_data()?;
    c.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}

fn load_auction(info: &AccountInfo) -> Result<AuctionTermsRecord, ProgramError> {
    AuctionTermsRecord::try_from_slice(&info.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)
}

fn save_auction(info: &AccountInfo, a: &AuctionTermsRecord) -> ProgramResult {
    let mut data = info.try_borrow_mut_data()?;
    a.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}

fn load_hold(info: &AccountInfo) -> Result<HoldRecord, ProgramError> {
    HoldRecord::try_from_slice(&info.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)
}

fn save_hold(info: &AccountInfo, h: &HoldRecord) -> ProgramResult {
    let mut data = info.try_borrow_mut_data()?;
    h.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}

fn close_answers_from_binding<'a>(
    program_id: &Pubkey,
    binding: &AccountInfo<'a>,
    passport_config: &AccountInfo<'a>,
    answer_funder: &AccountInfo<'a>,
    answer_leave: &AccountInfo<'a>,
    answer_open: &AccountInfo<'a>,
    token_id: &[u8; 32],
) -> ProgramResult {
    let passport_program = require_bound_passport_program(program_id, binding)?;
    let (seed_prefix, _) =
        encumbrance_seed_prefix_for_source(passport_config, &passport_program, program_id)?;
    close_obligation(
        program_id,
        answer_funder,
        answer_leave,
        answer_open,
        &seed_prefix,
        token_id,
    )
}

fn bind_passport_program(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_program = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    if !passport_program.executable {
        return Err(ProgramError::InvalidAccountData);
    }
    let (key, bump) = passport_binding_pda(program_id);
    if binding.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    require_binding_uninitialised(binding)?;
    if !binding.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    create_pda(
        program_id,
        payer,
        binding,
        system,
        PassportBinding::SPACE,
        &[PASSPORT_BINDING_SEED, &[bump]],
    )?;
    let rec = PassportBinding::new(*passport_program.key, bump);
    let mut data = binding.try_borrow_mut_data()?;
    rec.serialize(&mut &mut data[..PassportBinding::SPACE])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}

fn create_pda<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    account: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    space: usize,
    seeds: &[&[u8]],
) -> ProgramResult {
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(space);
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            account.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[payer.clone(), account.clone(), system.clone()],
        &[seeds],
    )
}

fn close_pda(account: &AccountInfo, recipient: &AccountInfo) -> ProgramResult {
    // Drain → zero data → assign. Do not realloc in the same ix as
    // SystemProgram::create_account (Agave balance-conservation).
    let lamports = account.lamports();
    **account.try_borrow_mut_lamports()? = 0;
    **recipient.try_borrow_mut_lamports()? = recipient
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    account.try_borrow_mut_data()?.fill(0);
    account.assign(&system_program::ID);
    Ok(())
}

fn parse_comp(form: u8, commission_bps: u16) -> Result<Compensation, ProgramError> {
    if CompensationForm::from_u8(form).is_none() {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(Compensation {
        form,
        commission_bps,
    })
}

fn parse_denom(kind: u8, currency_code: [u8; 32]) -> Result<Denomination, ProgramError> {
    if DenominationKind::from_u8(kind).is_none() {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(Denomination {
        kind,
        currency_code,
    })
}

fn asset_denom() -> Denomination {
    Denomination {
        kind: DenominationKind::Asset as u8,
        currency_code: [0u8; 32],
    }
}

fn require_payment_token_enabled(
    program_id: &Pubkey,
    asset_mint: &[u8; 32],
    payment_token_info: Option<&AccountInfo>,
) -> Result<(), ProgramError> {
    if *asset_mint == [0u8; 32] {
        return Ok(());
    }
    let info = payment_token_info.ok_or_else(|| into_pe(KargainError::PaymentTokenNotSupported))?;
    let (key, _) = payment_token_pda(program_id, asset_mint);
    if info.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    if info.data_is_empty() {
        return Err(into_pe(KargainError::PaymentTokenNotSupported));
    }
    let rec = PaymentTokenRecord::try_from_slice(&info.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if !rec.enabled || rec.mint != *asset_mint {
        return Err(into_pe(KargainError::PaymentTokenNotSupported));
    }
    Ok(())
}

fn require_active_verifier_account(
    stake_info: &AccountInfo,
    runner: &[u8; 32],
    staking_program: &Pubkey,
) -> Result<(), ProgramError> {
    let owned = stake_info.owner == staking_program;
    if stake_info.data_is_empty() {
        return prove_active_verifier(None, runner, owned, Some(stake_info.key), staking_program)
            .map_err(into_pe);
    }
    let data = stake_info.try_borrow_data()?;
    prove_active_verifier(
        Some(data.as_ref()),
        runner,
        owned,
        Some(stake_info.key),
        staking_program,
    )
    .map_err(into_pe)
}

fn require_auction_open_params(
    reserve: u64,
    duration: u64,
    protection_window: u64,
) -> Result<(), ProgramError> {
    if reserve == 0 {
        return Err(into_pe(KargainError::BadReserve));
    }
    if duration < MIN_DURATION || duration > MAX_DURATION {
        return Err(into_pe(KargainError::BadDuration));
    }
    if protection_window < MIN_PROTECTION_WINDOW || protection_window > MAX_PROTECTION_WINDOW {
        return Err(into_pe(KargainError::ProtectionOutOfBounds));
    }
    Ok(())
}

fn require_auction_rules_bond(challenge_bond: u64) -> Result<(), ProgramError> {
    if challenge_bond == 0 {
        return Err(into_pe(KargainError::BadConfig));
    }
    if MIN_DURATION == 0 || MAX_DURATION < MIN_DURATION {
        return Err(into_pe(KargainError::BadConfig));
    }
    if EXTENSION_WINDOW == 0 || ABANDONMENT_WINDOW == 0 {
        return Err(into_pe(KargainError::BadConfig));
    }
    if MIN_PROTECTION_WINDOW == 0 || MAX_PROTECTION_WINDOW < MIN_PROTECTION_WINDOW {
        return Err(into_pe(KargainError::BadConfig));
    }
    if MIN_INCREMENT_BPS == 0 || u64::from(MIN_INCREMENT_BPS) > BPS_DENOM {
        return Err(into_pe(KargainError::BadConfig));
    }
    Ok(())
}

fn is_binding(c: &ConsignmentRecord, hold_active: bool) -> bool {
    c.phase == Phase::Offered as u8 && c.committed_not_offered && !hold_active
}

fn hold_is_active(hold_info: &AccountInfo) -> Result<bool, ProgramError> {
    if hold_info.data_is_empty() {
        return Ok(false);
    }
    Ok(load_hold(hold_info)?.is_active())
}

fn ensure_consignment_account<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    consignment: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    token_id: &[u8; 32],
) -> Result<u8, ProgramError> {
    let (key, bump) = consignment_pda(program_id, token_id);
    if consignment.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    if consignment.data_is_empty() {
        create_pda(
            program_id,
            payer,
            consignment,
            system,
            ConsignmentRecord::SPACE,
            &[CONSIGNMENT_SEED, token_id, &[bump]],
        )?;
    }
    Ok(bump)
}

fn ensure_escrow<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    escrow: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    token_id: &[u8; 32],
) -> Result<u8, ProgramError> {
    let (key, bump) = escrow_pda(program_id, token_id);
    if escrow.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    if escrow.data_is_empty() {
        create_pda(
            program_id,
            payer,
            escrow,
            system,
            1,
            &[ESCROW_SEED, token_id, &[bump]],
        )?;
    }
    Ok(bump)
}

fn apply_extension(auction: &mut AuctionTermsRecord, now: u64) {
    if auction.ends_at == 0 {
        return;
    }
    if now.saturating_add(auction.extension_window) >= auction.ends_at {
        let extended = now.saturating_add(auction.extension_window);
        if extended > auction.ends_at {
            auction.ends_at = extended;
        }
    }
}

fn is_challenge_active(challenge_info: &AccountInfo) -> Result<bool, ProgramError> {
    if challenge_info.data_is_empty() {
        return Ok(false);
    }
    let data = challenge_info.try_borrow_data()?;
    Ok(ChallengeAccount::try_from_slice(&data)
        .map_err(|_| ProgramError::InvalidAccountData)?
        .is_active())
}

// ---- Challenge hooks ----

struct AscHooks<'a> {
    hold: &'a mut HoldRecord,
    consignment: &'a ConsignmentRecord,
    challenge_bond: u64,
    judge_qualified: bool,
    now: u64,
    /// Gross to pay-split after reject/expire (hold cleared in hook).
    pending_split_gross: Option<u64>,
}

impl ChallengeHooks for AscHooks<'_> {
    fn required_bond_amount(&self) -> u64 {
        self.challenge_bond
    }

    fn require_challenge_action_allowed(&self, _subject_id: &[u8; 32]) -> Result<(), KargainError> {
        Ok(())
    }

    fn is_eligible_challenger(&self, _subject_id: &[u8; 32], challenger: &[u8; 32]) -> bool {
        self.hold.is_active() && *challenger == self.hold.buyer && !self.hold.reversal_pending
    }

    fn is_qualified_judge(&self, _subject_id: &[u8; 32], _judge: &[u8; 32]) -> bool {
        self.judge_qualified
    }

    fn is_excluded_judge(
        &self,
        _subject_id: &[u8; 32],
        _challenger: &[u8; 32],
        judge: &[u8; 32],
    ) -> bool {
        *judge == self.hold.buyer
            || *judge == self.consignment.seller
            || (self.consignment.agent != [0u8; 32] && *judge == self.consignment.agent)
    }

    fn on_upheld(&mut self, _subject_id: &[u8; 32], _challenger: &[u8; 32], _judge: &[u8; 32]) {
        self.hold.reversal_pending = true;
        self.hold.frozen_remaining = 0;
        self.hold.protection_ends_at = 0;
        self.hold.abandonment_deadline = self.now.saturating_add(self.hold.abandonment_window);
    }

    fn on_rejected(&mut self, _subject_id: &[u8; 32], _challenger: &[u8; 32], _judge: &[u8; 32]) {
        self.pending_split_gross = Some(self.hold.gross);
        self.hold.clear();
    }

    fn on_expired(&mut self, _subject_id: &[u8; 32], _challenger: &[u8; 32]) {
        self.pending_split_gross = Some(self.hold.gross);
        self.hold.clear();
    }

    fn on_withdrawn(&mut self, _subject_id: &[u8; 32], _challenger: &[u8; 32]) {
        let remaining = self.hold.frozen_remaining;
        self.hold.frozen_remaining = 0;
        self.hold.protection_ends_at = self.now.saturating_add(remaining);
    }
}

// ---- Admin / asset ----

fn init_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    fee_bps: u16,
    challenge_bond: u64,
    challenge_window: u64,
    staking_program: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let payer = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let platform = next_account_info(iter)?;
    let guardian = next_account_info(iter)?;
    let forfeit = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    if !payer.is_signer || !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    require_auction_rules_bond(challenge_bond)?;
    if challenge_window == 0 {
        return Err(into_pe(KargainError::ZeroChallengeWindow));
    }
    if staking_program == [0u8; 32] || forfeit.key.to_bytes() == [0u8; 32] {
        return Err(into_pe(KargainError::ZeroAddress));
    }
    if platform.key.to_bytes() == [0u8; 32] || guardian.key.to_bytes() == [0u8; 32] {
        return Err(into_pe(KargainError::ZeroAddress));
    }
    if u64::from(fee_bps) > BPS_DENOM {
        return Err(into_pe(KargainError::FeeTooHigh));
    }
    let (key, bump) = config_pda(program_id);
    if config.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    if !config.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    create_pda(
        program_id,
        payer,
        config,
        system,
        AscendingConfig::SPACE,
        &[CONFIG_SEED, &[bump]],
    )?;
    let cfg = AscendingConfig {
        discriminator: ASC_CONFIG_DISC,
        authority: authority.key.to_bytes(),
        platform_recipient: platform.key.to_bytes(),
        platform_fee_bps: fee_bps,
        guardian: guardian.key.to_bytes(),
        paused: false,
        self_encumbrance_registered_retired: true,
        staking_program,
        forfeit_recipient: forfeit.key.to_bytes(),
        challenge_bond,
        challenge_window,
        challenge_configured: true,
        bump,
    };
    save_asc_config(config, &cfg)?;
    generated::emit_ascending_consignment_auction_rules_set(
        MIN_DURATION,
        MAX_DURATION,
        EXTENSION_WINDOW,
        MIN_INCREMENT_BPS,
        MIN_PROTECTION_WINDOW,
        MAX_PROTECTION_WINDOW,
        ABANDONMENT_WINDOW,
        challenge_bond,
    );
    Ok(())
}

fn refuse_harness(_program_id: &Pubkey, _accounts: &[AccountInfo]) -> ProgramResult {
    Err(into_pe(KargainError::HarnessInstructionRetired))
}

fn create_asset(program_id: &Pubkey, accounts: &[AccountInfo], _token_id: [u8; 32]) -> ProgramResult {
    refuse_harness(program_id, accounts)
}

fn approve_escrow(program_id: &Pubkey, accounts: &[AccountInfo], _token_id: [u8; 32]) -> ProgramResult {
    refuse_harness(program_id, accounts)
}

fn set_may_open(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _token_id: [u8; 32],
    _allowed: bool,
) -> ProgramResult {
    refuse_harness(program_id, accounts)
}

fn set_verified(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _token_id: [u8; 32],
    _verified: bool,
) -> ProgramResult {
    refuse_harness(program_id, accounts)
}

fn set_self_enc(program_id: &Pubkey, accounts: &[AccountInfo], _registered: bool) -> ProgramResult {
    refuse_harness(program_id, accounts)
}

fn grant(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    agent: [u8; 32],
    expiry: u64,
    asset_mint: [u8; 32],
    denom_kind: u8,
    currency_code: [u8; 32],
    floor: u64,
    form: u8,
    commission_bps: u16,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let owner = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let mandate_info = next_account_info(iter)?;
    let consignment_info = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !owner.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let passport_program = require_bound_passport_program(program_id, binding)?;
    require_passport_core_asset(&passport_program, &token_id, asset_info)?;
    let owner_pk = core_asset_owner(asset_info)?;
    let (cust_key, _) = custody_authority_pda(program_id);
    if custody.key != &cust_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let asset_data = asset_info.try_borrow_data()?;
    let transfer_delegate_ok = has_transfer_delegate(&asset_data, &cust_key)?;
    drop(asset_data);
    let is_live = consignment_account_is_live(consignment_info)?;
    let denom = parse_denom(denom_kind, currency_code)?;
    let comp = parse_comp(form, commission_bps)?;
    let (mkey, mbump) = mandate_pda(program_id, &token_id);
    if mandate_info.key != &mkey {
        return Err(ProgramError::InvalidSeeds);
    }
    let record = grant_mandate(
        token_id,
        &owner_pk.to_bytes(),
        &owner.key.to_bytes(),
        is_live,
        transfer_delegate_ok,
        agent,
        expiry,
        asset_mint,
        denom,
        floor,
        comp,
        mbump,
    )
    .map_err(into_pe)?;
    if mandate_info.data_is_empty() {
        create_pda(
            program_id,
            payer,
            mandate_info,
            system,
            MandateRecord::SPACE,
            &[MANDATE_SEED, &token_id, &[mbump]],
        )?;
    }
    let mut data = mandate_info.try_borrow_mut_data()?;
    record
        .serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &event_mandate_granted(
            token_id,
            owner.key.to_bytes(),
            record.agent,
            record.expiry,
            record.asset,
            record.denomination,
            record.floor,
            record.compensation,
        ),
    );
    Ok(())
}

fn revoke(program_id: &Pubkey, accounts: &[AccountInfo], token_id: [u8; 32]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let owner = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let mandate_info = next_account_info(iter)?;
    let consignment_info = next_account_info(iter)?;
    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let passport_program = require_bound_passport_program(program_id, binding)?;
    require_passport_core_asset(&passport_program, &token_id, asset_info)?;
    let owner_pk = core_asset_owner(asset_info)?;
    let m = {
        let data = mandate_info.try_borrow_data()?;
        MandateRecord::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)?
    };
    let is_live = consignment_account_is_live(consignment_info)?;
    revoke_mandate(&m, &owner_pk.to_bytes(), &owner.key.to_bytes(), is_live).map_err(into_pe)?;
    let prior_agent = m.agent;
    let mut cleared = m;
    cleared.active = false;
    let mut data = mandate_info.try_borrow_mut_data()?;
    cleared
        .serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &ConsignmentEvent::MandateRevoked {
            token_id,
            owner: owner.key.to_bytes(),
            prior_agent,
        },
    );
    Ok(())
}

// ---- Open ascending ----

fn write_auction_terms<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    auction_info: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    token_id: [u8; 32],
    duration: u64,
    protection_window: u64,
) -> ProgramResult {
    let (akey, abump) = auction_pda(program_id, &token_id);
    if auction_info.key != &akey {
        return Err(ProgramError::InvalidSeeds);
    }
    if auction_info.data_is_empty() {
        create_pda(
            program_id,
            payer,
            auction_info,
            system,
            AuctionTermsRecord::SPACE,
            &[AUCTION_SEED, &token_id, &[abump]],
        )?;
    }
    let rec = AuctionTermsRecord {
        discriminator: AUCTION_DISC,
        token_id,
        duration,
        ends_at: 0,
        extension_window: EXTENSION_WINDOW,
        protection_window,
        abandonment_window: ABANDONMENT_WINDOW,
        min_increment_bps: MIN_INCREMENT_BPS,
        highest_bidder: [0u8; 32],
        highest_bid: 0,
        bump: abump,
    };
    save_auction(auction_info, &rec)
}

fn open_ascending_direct(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    asset_mint: [u8; 32],
    reserve: u64,
    duration: u64,
    protection_window: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let seller = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    if !seller.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    require_not_paused(&cfg.as_commerce_config()).map_err(into_pe)?;

    let payment_tok = if asset_mint != [0u8; 32] {
        Some(next_account_info(iter)?)
    } else {
        None
    };
    require_payment_token_enabled(program_id, &asset_mint, payment_tok)?;

    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let challenge = next_account_info(iter)?;

    let passport_program = require_bound_passport_program(program_id, binding)?;
    let (_seed_prefix, registry_len) =
        encumbrance_seed_prefix_for_source(passport_config, &passport_program, program_id)?;

    let mut may_accounts: Vec<AccountInfo> = Vec::with_capacity(3 + registry_len);
    may_accounts.push(passport_config.clone());
    may_accounts.push(asset_info.clone());
    may_accounts.push(challenge.clone());
    for _ in 0..registry_len {
        may_accounts.push(next_account_info(iter)?.clone());
    }
    let allowed = resolve_may_accounts(
        &passport_program,
        &may_accounts,
        token_id,
        INTENT_OPEN_CONSIGNMENT,
    )?;
    if !allowed {
        return Err(into_pe(KargainError::OpenConsignmentRefused));
    }

    let passport_state = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let stake_answer = next_account_info(iter)?;
    let staking_program = next_account_info(iter)?;
    let auction_info = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if staking_program.key.to_bytes() != cfg.staking_program {
        return Err(ProgramError::InvalidAccountData);
    }
    require_active_verifier_account(stake_answer, &seller.key.to_bytes(), staking_program.key)?;

    let is_live = consignment_account_is_live(consignment)?;
    if is_live {
        return Err(into_pe(KargainError::LiveConsignment));
    }

    let owner_pk = core_asset_owner(asset_info)?;
    if owner_pk != *seller.key {
        return Err(into_pe(KargainError::NotPassportOwner));
    }
    require_verified_passport_status(&passport_program, &token_id, passport_state)?;
    require_auction_open_params(reserve, duration, protection_window)?;

    let bump = ensure_consignment_account(program_id, payer, consignment, system, &token_id)?;
    transfer_owner_to_custody(
        program_id,
        &passport_program,
        &token_id,
        asset_info,
        seller,
        custody,
        payer,
        core_program,
        system,
    )?;

    let now = Clock::get()?.unix_timestamp as u64;
    let record = write_open(
        token_id,
        seller.key.to_bytes(),
        [0u8; 32],
        asset_mint,
        asset_denom(),
        0,
        Compensation::margin(),
        reserve,
        cfg.platform_fee_bps,
        now,
        bump,
    );
    save_consignment(consignment, &record)?;
    write_auction_terms(
        program_id,
        payer,
        auction_info,
        system,
        token_id,
        duration,
        protection_window,
    )?;
    
    emit_commerce(COMMERCE_EMITTER, &event_opened(&record));
    generated::emit_ascending_consignment_ascending_terms_snapshotted(
        token_id,
        duration,
        EXTENSION_WINDOW,
        protection_window,
        ABANDONMENT_WINDOW,
        MIN_INCREMENT_BPS,
        reserve,
    );
    Ok(())
}

fn open_ascending_from_mandate(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    reserve: u64,
    duration: u64,
    protection_window: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let agent = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let mandate_info = next_account_info(iter)?;
    if !agent.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    require_not_paused(&cfg.as_commerce_config()).map_err(into_pe)?;
    let m = {
        let data = mandate_info.try_borrow_data()?;
        MandateRecord::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)?
    };
    let now = Clock::get()?.unix_timestamp as u64;
    require_mandate_allows_open(&m, &asset_denom(), now).map_err(into_pe)?;
    if m.denomination.kind != DenominationKind::Asset as u8 {
        return Err(into_pe(KargainError::FiatDenominationRefused));
    }
    if m.agent != agent.key.to_bytes() {
        return Err(into_pe(KargainError::NotConsignmentAgent));
    }

    let payment_tok = if m.asset != [0u8; 32] {
        Some(next_account_info(iter)?)
    } else {
        None
    };
    require_payment_token_enabled(program_id, &m.asset, payment_tok)?;

    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let challenge = next_account_info(iter)?;

    let passport_program = require_bound_passport_program(program_id, binding)?;
    let (_seed_prefix, registry_len) =
        encumbrance_seed_prefix_for_source(passport_config, &passport_program, program_id)?;

    let mut may_accounts: Vec<AccountInfo> = Vec::with_capacity(3 + registry_len);
    may_accounts.push(passport_config.clone());
    may_accounts.push(asset_info.clone());
    may_accounts.push(challenge.clone());
    for _ in 0..registry_len {
        may_accounts.push(next_account_info(iter)?.clone());
    }
    let allowed = resolve_may_accounts(
        &passport_program,
        &may_accounts,
        token_id,
        INTENT_OPEN_CONSIGNMENT,
    )?;
    if !allowed {
        return Err(into_pe(KargainError::OpenConsignmentRefused));
    }

    let passport_state = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let stake_answer = next_account_info(iter)?;
    let staking_program = next_account_info(iter)?;
    let auction_info = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if staking_program.key.to_bytes() != cfg.staking_program {
        return Err(ProgramError::InvalidAccountData);
    }
    require_active_verifier_account(stake_answer, &agent.key.to_bytes(), staking_program.key)?;

    let is_live = consignment_account_is_live(consignment)?;
    if is_live {
        return Err(into_pe(KargainError::LiveConsignment));
    }
    let (cust_key, _) = custody_authority_pda(program_id);
    if custody.key != &cust_key {
        return Err(ProgramError::InvalidSeeds);
    }
    require_transfer_delegate(asset_info, &cust_key)?;
    require_verified_passport_status(&passport_program, &token_id, passport_state)?;
    require_auction_open_params(reserve, duration, protection_window)?;
    require_agented_price_meets_floor(reserve, m.floor, m.compensation, cfg.platform_fee_bps)
        .map_err(into_pe)?;

    let seller = core_asset_owner(asset_info)?;
    let bump = ensure_consignment_account(program_id, payer, consignment, system, &token_id)?;
    transfer_delegate_to_custody(
        program_id,
        &passport_program,
        &token_id,
        asset_info,
        custody,
        payer,
        core_program,
        system,
    )?;

    let record = write_open(
        token_id,
        seller.to_bytes(),
        m.agent,
        m.asset,
        m.denomination,
        m.floor,
        m.compensation,
        reserve,
        cfg.platform_fee_bps,
        now,
        bump,
    );
    save_consignment(consignment, &record)?;
    write_auction_terms(
        program_id,
        payer,
        auction_info,
        system,
        token_id,
        duration,
        protection_window,
    )?;
    
    emit_commerce(COMMERCE_EMITTER, &event_opened(&record));
    generated::emit_ascending_consignment_ascending_terms_snapshotted(
        token_id,
        duration,
        EXTENSION_WINDOW,
        protection_window,
        ABANDONMENT_WINDOW,
        MIN_INCREMENT_BPS,
        reserve,
    );
    Ok(())
}

// ---- Bid ----

fn bid(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    amount: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let bidder = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let auction_info = next_account_info(iter)?;
    let hold_info = next_account_info(iter)?;
    let escrow = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !bidder.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    require_not_paused(&cfg.as_commerce_config()).map_err(into_pe)?;
    if hold_is_active(hold_info)? {
        return Err(into_pe(KargainError::SettlementPending));
    }
    let (ckey, _) = consignment_pda(program_id, &token_id);
    if consignment.key != &ckey {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut c = load_consignment(consignment)?;
    let binding = is_binding(&c, false);
    if !c.is_offered_actionable() && !binding {
        return Err(into_pe(KargainError::NotOffered));
    }
    if bidder.key.to_bytes() == c.seller {
        return Err(into_pe(KargainError::BidFromSeller));
    }
    if c.agent != [0u8; 32] && bidder.key.to_bytes() == c.agent {
        return Err(into_pe(KargainError::BidFromAgent));
    }
    let (akey, _) = auction_pda(program_id, &token_id);
    if auction_info.key != &akey {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut auction = load_auction(auction_info)?;
    let now = Clock::get()?.unix_timestamp as u64;
    if auction.ends_at != 0 && now >= auction.ends_at {
        return Err(into_pe(KargainError::AuctionEnded));
    }
    if auction.highest_bidder == [0u8; 32] {
        if amount < c.price {
            return Err(into_pe(KargainError::BidTooLow));
        }
    } else {
        let min_next = auction
            .highest_bid
            .saturating_add(
                (u128::from(auction.highest_bid) * u128::from(auction.min_increment_bps)
                    / u128::from(BPS_DENOM)) as u64,
            );
        if amount < min_next || amount <= auction.highest_bid {
            return Err(into_pe(KargainError::BidTooLow));
        }
    }

    let escrow_bump = ensure_escrow(program_id, payer, escrow, system, &token_id)?;
    let native = c.asset == [0u8; 32];
    let mut spl_ctx: Option<(&AccountInfo, &AccountInfo, &AccountInfo)> = None;
    if native {
        pay_native(bidder, escrow, amount, system)?;
    } else {
        let bidder_ata = next_account_info(iter)?;
        let escrow_ata = next_account_info(iter)?;
        let mint = next_account_info(iter)?;
        let token_program = next_account_info(iter)?;
        if mint.key.to_bytes() != c.asset {
            return Err(ProgramError::InvalidAccountData);
        }
        let before = spl_token_account_amount(&escrow_ata.try_borrow_data()?).map_err(into_pe)?;
        invoke(
            &spl_transfer(
                token_program.key,
                bidder_ata.key,
                escrow_ata.key,
                bidder.key,
                amount,
            ),
            &[
                bidder_ata.clone(),
                escrow_ata.clone(),
                bidder.clone(),
                token_program.clone(),
            ],
        )?;
        let after = spl_token_account_amount(&escrow_ata.try_borrow_data()?).map_err(into_pe)?;
        require_full_delivery(before, after, amount).map_err(into_pe)?;
        spl_ctx = Some((escrow_ata, mint, token_program));
    }

    let prev = auction.highest_bidder;
    let prev_amt = auction.highest_bid;
    let first = prev == [0u8; 32];
    if first {
        enter_committed_not_offered(&mut c).map_err(into_pe)?;
        auction.ends_at = now.saturating_add(auction.duration);
        save_consignment(consignment, &c)?;
    }
    auction.highest_bidder = bidder.key.to_bytes();
    auction.highest_bid = amount;
    apply_extension(&mut auction, now);
    save_auction(auction_info, &auction)?;

    if !first {
        generated::emit_ascending_consignment_bid_refunded(
            token_id,
            prev,
            c.asset,
            prev_amt,
        );
    }
    generated::emit_ascending_consignment_bid_placed(
        token_id,
        bidder.key.to_bytes(),
        amount,
        auction.ends_at,
    );

    if !first {
        let prev_acc = next_account_info(iter)?;
        if prev_acc.key.to_bytes() != prev {
            return Err(ProgramError::InvalidAccountData);
        }
        if native {
            pay_native_from_pda(escrow, prev_acc, prev_amt)?;
        } else {
            let (escrow_ata, mint, token_program) =
                spl_ctx.ok_or(ProgramError::InvalidAccountData)?;
            let prev_ata = next_account_info(iter)?;
            let claim_info = next_account_info(iter)?;
            let claim_ata = next_account_info(iter)?;
            let escrow_seeds: &[&[u8]] = &[ESCROW_SEED, token_id.as_ref(), &[escrow_bump]];
            pay_spl_leg_signed(
                program_id,
                payer,
                escrow_ata,
                escrow,
                escrow_seeds,
                prev_acc,
                prev_ata,
                claim_info,
                claim_ata,
                mint,
                token_program,
                system,
                prev_amt,
            )?;
        }
    }
    Ok(())
}

// ---- Settle (no money move) ----

fn settle(program_id: &Pubkey, accounts: &[AccountInfo], token_id: [u8; 32]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let _caller = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let auction_info = next_account_info(iter)?;
    let hold_info = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let buyer_acc = next_account_info(iter)?;
    let escrow = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (ckey, _) = consignment_pda(program_id, &token_id);
    if consignment.key != &ckey {
        return Err(ProgramError::InvalidSeeds);
    }
    let c = load_consignment(consignment)?;
    if hold_is_active(hold_info)? {
        return Err(into_pe(KargainError::SettlementPending));
    }
    if !is_binding(&c, false) {
        return Err(into_pe(KargainError::NotBinding));
    }
    let (akey, _) = auction_pda(program_id, &token_id);
    if auction_info.key != &akey {
        return Err(ProgramError::InvalidSeeds);
    }
    let auction = load_auction(auction_info)?;
    if auction.ends_at == 0 {
        return Err(into_pe(KargainError::NotBinding));
    }
    let now = Clock::get()?.unix_timestamp as u64;
    if now < auction.ends_at {
        return Err(into_pe(KargainError::AuctionNotEnded));
    }

    let escrow_lamports_before = escrow.lamports();
    let escrow_ata = if c.asset != [0u8; 32] {
        Some(next_account_info(iter)?)
    } else {
        None
    };
    let escrow_spl_before = if let Some(ata) = escrow_ata {
        Some(spl_token_account_amount(&ata.try_borrow_data()?).map_err(into_pe)?)
    } else {
        None
    };

    let buyer = auction.highest_bidder;
    if buyer_acc.key.to_bytes() != buyer {
        return Err(ProgramError::InvalidAccountData);
    }
    let gross = auction.highest_bid;
    let protection_ends_at = now.saturating_add(auction.protection_window);
    let abandon_win = auction.abandonment_window;

    let (hkey, hbump) = hold_pda(program_id, &token_id);
    if hold_info.key != &hkey {
        return Err(ProgramError::InvalidSeeds);
    }
    // Create hold first (SystemProgram CPI), then close auction → payer.
    // Ordering avoids mixing drained-auction state with create_account CPI.
    if hold_info.data_is_empty() {
        create_pda(
            program_id,
            payer,
            hold_info,
            system,
            HoldRecord::SPACE,
            &[HOLD_SEED, &token_id, &[hbump]],
        )?;
    }
    let hold = HoldRecord {
        discriminator: HOLD_DISC,
        token_id,
        buyer,
        gross,
        protection_ends_at,
        frozen_remaining: 0,
        reversal_pending: false,
        abandonment_deadline: 0,
        abandonment_window: abandon_win,
        bump: hbump,
    };
    save_hold(hold_info, &hold)?;

    // Core move before closing auction — TransferV1 CPI must not share an ix
    // with a just-drained System-assigned account (Agave balance conservation).
    let passport_program = require_bound_passport_program(program_id, binding)?;
    let (seed_prefix, _) =
        encumbrance_seed_prefix_for_source(passport_config, &passport_program, program_id)?;
    transfer_custody_to_recipient(
        program_id,
        &passport_program,
        &token_id,
        asset_info,
        custody,
        buyer_acc,
        payer,
        core_program,
        system,
    )?;
    open_obligation(
        program_id,
        payer,
        answer_leave,
        answer_open,
        system,
        &seed_prefix,
        &token_id,
    )?;

    close_pda(auction_info, payer)?;

    if escrow.lamports() != escrow_lamports_before {
        return Err(ProgramError::InvalidAccountData);
    }
    if let (Some(expected), Some(ata)) = (escrow_spl_before, escrow_ata) {
        let after = spl_token_account_amount(&ata.try_borrow_data()?).map_err(into_pe)?;
        if after != expected {
            return Err(ProgramError::InvalidAccountData);
        }
    }
    generated::emit_ascending_consignment_settled(
        token_id,
        buyer,
        gross,
        protection_ends_at,
    );
    Ok(())
}

// ---- Hold exits ----

fn confirm_receipt(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let buyer = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let _consignment = next_account_info(iter)?;
    let hold_info = next_account_info(iter)?;
    let challenge_info = next_account_info(iter)?;
    let _escrow = next_account_info(iter)?;
    let _platform = next_account_info(iter)?;
    let _seller_acc = next_account_info(iter)?;
    let _agent_acc = next_account_info(iter)?;
    let _system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    let answer_funder = next_account_info(iter)?;
    if !buyer.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    let mut hold = load_hold(hold_info)?;
    if !hold.is_active() {
        return Err(into_pe(KargainError::NoHold));
    }
    if buyer.key.to_bytes() != hold.buyer {
        return Err(into_pe(KargainError::NotHoldBuyer));
    }
    if is_challenge_active(challenge_info)? {
        return Err(into_pe(KargainError::DisputeActive));
    }
    if hold.reversal_pending {
        return Err(into_pe(KargainError::ReversalPending));
    }
    let gross = hold.gross;
    let hold_buyer = hold.buyer;
    hold.clear();
    save_hold(hold_info, &hold)?;
    close_answers_from_binding(
        program_id,
        binding,
        passport_config,
        answer_funder,
        answer_leave,
        answer_open,
        &token_id,
    )?;
    generated::emit_ascending_consignment_receipt_confirmed(token_id, hold_buyer);
    pay_split_and_close(
        program_id,
        accounts,
        PaySplitIdx {
            consignment: 2,
            escrow: 5,
            platform: 6,
            seller: 7,
            agent: 8,
            system: 9,
            payer: 10,
            spl_start: 15,
        },
        &cfg,
        token_id,
        gross,
        CloseReason::HoldReleased,
    )
}

fn release_funds(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let _caller = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let _consignment = next_account_info(iter)?;
    let hold_info = next_account_info(iter)?;
    let challenge_info = next_account_info(iter)?;
    let _escrow = next_account_info(iter)?;
    let _platform = next_account_info(iter)?;
    let _seller_acc = next_account_info(iter)?;
    let _agent_acc = next_account_info(iter)?;
    let _system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    let answer_funder = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    let mut hold = load_hold(hold_info)?;
    if !hold.is_active() {
        return Err(into_pe(KargainError::NoHold));
    }
    if is_challenge_active(challenge_info)? {
        return Err(into_pe(KargainError::DisputeActive));
    }
    if hold.reversal_pending {
        return Err(into_pe(KargainError::ReversalPending));
    }
    let now = Clock::get()?.unix_timestamp as u64;
    if now < hold.protection_ends_at {
        return Err(into_pe(KargainError::HoldNotReady));
    }
    let gross = hold.gross;
    let hold_buyer = hold.buyer;
    hold.clear();
    save_hold(hold_info, &hold)?;
    close_answers_from_binding(
        program_id,
        binding,
        passport_config,
        answer_funder,
        answer_leave,
        answer_open,
        &token_id,
    )?;
    generated::emit_ascending_consignment_funds_released(token_id, hold_buyer);
    pay_split_and_close(
        program_id,
        accounts,
        PaySplitIdx {
            consignment: 2,
            escrow: 5,
            platform: 6,
            seller: 7,
            agent: 8,
            system: 9,
            payer: 10,
            spl_start: 15,
        },
        &cfg,
        token_id,
        gross,
        CloseReason::HoldReleased,
    )
}

fn complete_reversal(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let buyer = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let hold_info = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let seller_acc = next_account_info(iter)?;
    let escrow = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    let answer_funder = next_account_info(iter)?;
    if !buyer.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    let mut hold = load_hold(hold_info)?;
    if !hold.is_active() {
        return Err(into_pe(KargainError::NoHold));
    }
    if !hold.reversal_pending {
        return Err(into_pe(KargainError::NoReversalPending));
    }
    if buyer.key.to_bytes() != hold.buyer {
        return Err(into_pe(KargainError::NotHoldBuyer));
    }
    let owner_pk = core_asset_owner(asset_info)?;
    if owner_pk.to_bytes() != hold.buyer {
        return Err(into_pe(KargainError::NotPassportHolder));
    }
    let mut c = load_consignment(consignment)?;
    let seller = c.seller;
    if seller_acc.key.to_bytes() != seller {
        return Err(ProgramError::InvalidAccountData);
    }
    let gross = hold.gross;
    hold.clear();
    save_hold(hold_info, &hold)?;

    let passport_program = require_bound_passport_program(program_id, binding)?;
    let (seed_prefix, _) =
        encumbrance_seed_prefix_for_source(passport_config, &passport_program, program_id)?;
    transfer_owner_to_recipient(
        &passport_program,
        &token_id,
        asset_info,
        buyer,
        seller_acc,
        payer,
        core_program,
        system,
    )?;
    close_obligation(
        program_id,
        answer_funder,
        answer_leave,
        answer_open,
        &seed_prefix,
        &token_id,
    )?;
    terminate_to_owner(&mut c, CloseReason::ReversalCompleted);
    c.price = 0;
    c.floor = 0;
    save_consignment(consignment, &c)?;

    let (_, escrow_bump) = escrow_pda(program_id, &token_id);
    if c.asset == [0u8; 32] {
        pay_native_from_pda(escrow, buyer, gross)?;
    } else {
        let buyer_ata = next_account_info(iter)?;
        let escrow_ata = next_account_info(iter)?;
        let mint = next_account_info(iter)?;
        let token_program = next_account_info(iter)?;
        let claim_info = next_account_info(iter)?;
        let claim_ata = next_account_info(iter)?;
        let escrow_seeds: &[&[u8]] = &[ESCROW_SEED, token_id.as_ref(), &[escrow_bump]];
        pay_spl_leg_signed(
            program_id,
            payer,
            escrow_ata,
            escrow,
            escrow_seeds,
            buyer,
            buyer_ata,
            claim_info,
            claim_ata,
            mint,
            token_program,
            system,
            gross,
        )?;
    }
    generated::emit_ascending_consignment_reversal_completed(token_id, buyer.key.to_bytes());
    let _ = cfg;
    Ok(())
}

fn abandon_reversal(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let _caller = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let _consignment = next_account_info(iter)?;
    let hold_info = next_account_info(iter)?;
    let _escrow = next_account_info(iter)?;
    let _platform = next_account_info(iter)?;
    let _seller_acc = next_account_info(iter)?;
    let _agent_acc = next_account_info(iter)?;
    let _system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    let answer_funder = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    let mut hold = load_hold(hold_info)?;
    if !hold.is_active() {
        return Err(into_pe(KargainError::NoHold));
    }
    if !hold.reversal_pending {
        return Err(into_pe(KargainError::NoReversalPending));
    }
    let now = Clock::get()?.unix_timestamp as u64;
    if now < hold.abandonment_deadline {
        return Err(into_pe(KargainError::AbandonmentNotReady));
    }
    let gross = hold.gross;
    let hold_buyer = hold.buyer;
    hold.clear();
    save_hold(hold_info, &hold)?;
    close_answers_from_binding(
        program_id,
        binding,
        passport_config,
        answer_funder,
        answer_leave,
        answer_open,
        &token_id,
    )?;
    generated::emit_ascending_consignment_reversal_abandoned(token_id, hold_buyer);
    pay_split_and_close(
        program_id,
        accounts,
        PaySplitIdx {
            consignment: 2,
            escrow: 4,
            platform: 5,
            seller: 6,
            agent: 7,
            system: 8,
            payer: 9,
            spl_start: 14,
        },
        &cfg,
        token_id,
        gross,
        CloseReason::ReversalAbandoned,
    )
}

struct PaySplitIdx {
    consignment: usize,
    escrow: usize,
    platform: usize,
    seller: usize,
    agent: usize,
    system: usize,
    payer: usize,
    spl_start: usize,
}

fn pay_split_and_close(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    idx: PaySplitIdx,
    cfg: &AscendingConfig,
    token_id: [u8; 32],
    gross: u64,
    reason: CloseReason,
) -> ProgramResult {
    let consignment = accounts
        .get(idx.consignment)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let escrow = accounts
        .get(idx.escrow)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let platform = accounts
        .get(idx.platform)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let seller_acc = accounts
        .get(idx.seller)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let agent_acc = accounts
        .get(idx.agent)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let system = accounts
        .get(idx.system)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let payer = accounts
        .get(idx.payer)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;

    let mut c = load_consignment(consignment)?;
    let split = compute_split_for_lot(gross, &c).map_err(into_pe)?;
    let authorities = PayoutAuthorities {
        platform_recipient: cfg.platform_recipient,
        seller: c.seller,
        agent: c.agent,
    };
    verify_payout_recipient(
        PayoutLeg::Platform,
        split.platform,
        Some(&platform.key.to_bytes()),
        &authorities,
    )
    .map_err(into_pe)?;
    verify_payout_recipient(
        PayoutLeg::Seller,
        split.owner_amount,
        Some(&seller_acc.key.to_bytes()),
        &authorities,
    )
    .map_err(into_pe)?;
    let agent_bytes = agent_acc.key.to_bytes();
    verify_payout_recipient(
        PayoutLeg::Agent,
        split.agent_amount,
        if split.agent_amount == 0 {
            None
        } else {
            Some(&agent_bytes)
        },
        &authorities,
    )
    .map_err(into_pe)?;

    let (_, escrow_bump) = escrow_pda(program_id, &token_id);
    if c.asset == [0u8; 32] {
        pay_native_from_pda(escrow, platform, split.platform)?;
        pay_native_from_pda(escrow, seller_acc, split.owner_amount)?;
        if split.agent_amount != 0 {
            pay_native_from_pda(escrow, agent_acc, split.agent_amount)?;
        }
    } else {
        let remaining = accounts
            .get(idx.spl_start..)
            .ok_or(ProgramError::NotEnoughAccountKeys)?;
        let iter = &mut remaining.iter();
        let escrow_ata = next_account_info(iter)?;
        let mint = next_account_info(iter)?;
        let token_program = next_account_info(iter)?;
        let escrow_seeds: &[&[u8]] = &[ESCROW_SEED, token_id.as_ref(), &[escrow_bump]];
        pay_spl_leg_signed(
            program_id,
            payer,
            escrow_ata,
            escrow,
            escrow_seeds,
            platform,
            next_account_info(iter)?,
            next_account_info(iter)?,
            next_account_info(iter)?,
            mint,
            token_program,
            system,
            split.platform,
        )?;
        pay_spl_leg_signed(
            program_id,
            payer,
            escrow_ata,
            escrow,
            escrow_seeds,
            seller_acc,
            next_account_info(iter)?,
            next_account_info(iter)?,
            next_account_info(iter)?,
            mint,
            token_program,
            system,
            split.owner_amount,
        )?;
        if split.agent_amount != 0 {
            pay_spl_leg_signed(
                program_id,
                payer,
                escrow_ata,
                escrow,
                escrow_seeds,
                agent_acc,
                next_account_info(iter)?,
                next_account_info(iter)?,
                next_account_info(iter)?,
                mint,
                token_program,
                system,
                split.agent_amount,
            )?;
        }
    }
    close_lot(&mut c, reason);
    c.price = 0;
    c.floor = 0;
    save_consignment(consignment, &c)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &event_split_paid(
            token_id,
            c.asset,
            cfg.platform_recipient,
            c.seller,
            c.agent,
            &split,
        ),
    );
    emit_commerce(
        COMMERCE_EMITTER,
        &event_closed(token_id, reason),
    );
    Ok(())
}

// ---- Challenge ----

fn freeze_for_challenge(hold: &mut HoldRecord, now: u64) -> Result<(), ProgramError> {
    if !hold.is_active() {
        return Err(into_pe(KargainError::NoHold));
    }
    if hold.reversal_pending {
        return Err(into_pe(KargainError::ReversalPending));
    }
    if hold.frozen_remaining != 0 {
        return Err(into_pe(KargainError::DisputeActive));
    }
    if now >= hold.protection_ends_at {
        return Err(into_pe(KargainError::ProtectionElapsed));
    }
    hold.frozen_remaining = hold.protection_ends_at.saturating_sub(now);
    Ok(())
}

fn open_challenge_ix(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let challenger = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let hold_info = next_account_info(iter)?;
    let challenge_info = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !challenger.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    let c = load_consignment(consignment)?;
    let mut hold = load_hold(hold_info)?;
    let now = Clock::get()?.unix_timestamp as u64;
    freeze_for_challenge(&mut hold, now)?;

    let (chkey, chbump) = challenge_pda(program_id, &token_id);
    if challenge_info.key != &chkey {
        return Err(ProgramError::InvalidSeeds);
    }
    if !challenge_info.data_is_empty() {
        let existing = ChallengeAccount::try_from_slice(&challenge_info.try_borrow_data()?)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        if existing.is_active() {
            return Err(into_pe(KargainError::DisputeActive));
        }
    } else {
        create_pda(
            program_id,
            payer,
            challenge_info,
            system,
            ChallengeAccount::SPACE,
            &[CHALLENGE_SEED, &token_id, &[chbump]],
        )?;
    }

    let hooks = AscHooks {
        hold: &mut hold,
        consignment: &c,
        challenge_bond: cfg.challenge_bond,
        judge_qualified: false,
        now,
        pending_split_gross: None,
    };
    let (account, ev) = open_challenge(
        &cfg.challenge_config(),
        &hooks,
        token_id,
        challenger.key.to_bytes(),
        cfg.challenge_bond,
        now,
        chbump,
    )
    .map_err(into_pe)?;
    emit_challenge(CHALLENGE_EMITTER, &ev);
    // Fund bond into challenge PDA.
    pay_native(challenger, challenge_info, cfg.challenge_bond, system)?;
    {
        let mut data = challenge_info.try_borrow_mut_data()?;
        account
            .serialize(&mut &mut data[..])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
    }
    save_hold(hold_info, hooks.hold)?;
    Ok(())
}

fn withdraw_challenge_ix(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let challenger = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let hold_info = next_account_info(iter)?;
    let challenge_info = next_account_info(iter)?;
    if !challenger.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    let c = load_consignment(consignment)?;
    let mut hold = load_hold(hold_info)?;
    let mut account = ChallengeAccount::try_from_slice(&challenge_info.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let now = Clock::get()?.unix_timestamp as u64;
    let mut hooks = AscHooks {
        hold: &mut hold,
        consignment: &c,
        challenge_bond: cfg.challenge_bond,
        judge_qualified: false,
        now,
        pending_split_gross: None,
    };
    let (ev, disposition) = withdraw_challenge(
        &mut account,
        &mut hooks,
        challenger.key.to_bytes(),
        now,
    )
    .map_err(into_pe)?;
    emit_challenge(CHALLENGE_EMITTER, &ev);
    {
        let mut from = challenge_info.try_borrow_mut_lamports()?;
        let mut to = challenger.try_borrow_mut_lamports()?;
        transfer_bond_lamports(&mut from, &mut to, disposition.amount).map_err(into_pe)?;
    }
    {
        let mut data = challenge_info.try_borrow_mut_data()?;
        account
            .serialize(&mut &mut data[..])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
    }
    save_hold(hold_info, hooks.hold)?;
    let _ = (program_id, token_id);
    Ok(())
}

fn judge_challenge_ix(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    outcome: u8,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let judge = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let hold_info = next_account_info(iter)?;
    let challenge_info = next_account_info(iter)?;
    let bond_recipient = next_account_info(iter)?;
    let stake_answer = next_account_info(iter)?;
    let staking_program = next_account_info(iter)?;
    let _escrow = next_account_info(iter)?;
    let _platform = next_account_info(iter)?;
    let _seller_acc = next_account_info(iter)?;
    let _agent_acc = next_account_info(iter)?;
    let _system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    let answer_funder = next_account_info(iter)?;
    if !judge.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let outcome = match outcome {
        0 => JudgeOutcome::Upheld,
        1 => JudgeOutcome::Rejected,
        _ => return Err(ProgramError::InvalidInstructionData),
    };
    let cfg = load_asc_config(config)?;
    if staking_program.key.to_bytes() != cfg.staking_program {
        return Err(ProgramError::InvalidAccountData);
    }
    let judge_qualified = {
        require_active_verifier_account(stake_answer, &judge.key.to_bytes(), staking_program.key)?;
        true
    };
    let c = load_consignment(consignment)?;
    let mut hold = load_hold(hold_info)?;
    let mut account = ChallengeAccount::try_from_slice(&challenge_info.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let now = Clock::get()?.unix_timestamp as u64;
    let mut hooks = AscHooks {
        hold: &mut hold,
        consignment: &c,
        challenge_bond: cfg.challenge_bond,
        judge_qualified,
        now,
        pending_split_gross: None,
    };
    let (ev, disposition) = judge_challenge(
        &mut account,
        &cfg.challenge_config(),
        &mut hooks,
        judge.key.to_bytes(),
        outcome,
        now,
    )
    .map_err(into_pe)?;
    emit_challenge(CHALLENGE_EMITTER, &ev);
    if outcome == JudgeOutcome::Upheld {
        generated::emit_ascending_consignment_reversal_started(
            token_id,
            hooks.hold.buyer,
            hooks.hold.abandonment_deadline,
        );
    }
    if bond_recipient.key.to_bytes() != disposition.recipient {
        return Err(ProgramError::InvalidAccountData);
    }
    {
        let mut from = challenge_info.try_borrow_mut_lamports()?;
        let mut to = bond_recipient.try_borrow_mut_lamports()?;
        transfer_bond_lamports(&mut from, &mut to, disposition.amount).map_err(into_pe)?;
    }
    {
        let mut data = challenge_info.try_borrow_mut_data()?;
        account
            .serialize(&mut &mut data[..])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
    }
    let pending = hooks.pending_split_gross;
    save_hold(hold_info, hooks.hold)?;
    // on_rejected clears hold → write answers true; on_upheld does not flip answers.
    if pending.is_some() {
        close_answers_from_binding(
            program_id,
            binding,
            passport_config,
            answer_funder,
            answer_leave,
            answer_open,
            &token_id,
        )?;
    }
    if let Some(gross) = pending {
        pay_split_and_close(
            program_id,
            accounts,
            PaySplitIdx {
                consignment: 2,
                escrow: 8,
                platform: 9,
                seller: 10,
                agent: 11,
                system: 12,
                payer: 13,
                spl_start: 18,
            },
            &cfg,
            token_id,
            gross,
            CloseReason::HoldReleased,
        )?;
    }
    Ok(())
}

fn conclude_challenge_ix(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let _caller = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let hold_info = next_account_info(iter)?;
    let challenge_info = next_account_info(iter)?;
    let bond_recipient = next_account_info(iter)?;
    let _escrow = next_account_info(iter)?;
    let _platform = next_account_info(iter)?;
    let _seller_acc = next_account_info(iter)?;
    let _agent_acc = next_account_info(iter)?;
    let _system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    let answer_funder = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    let c = load_consignment(consignment)?;
    let mut hold = load_hold(hold_info)?;
    let mut account = ChallengeAccount::try_from_slice(&challenge_info.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let now = Clock::get()?.unix_timestamp as u64;
    let mut hooks = AscHooks {
        hold: &mut hold,
        consignment: &c,
        challenge_bond: cfg.challenge_bond,
        judge_qualified: false,
        now,
        pending_split_gross: None,
    };
    let (ev, disposition) = conclude_challenge(
        &mut account,
        &cfg.challenge_config(),
        &mut hooks,
        now,
    )
    .map_err(into_pe)?;
    emit_challenge(CHALLENGE_EMITTER, &ev);
    if bond_recipient.key.to_bytes() != disposition.recipient {
        return Err(ProgramError::InvalidAccountData);
    }
    {
        let mut from = challenge_info.try_borrow_mut_lamports()?;
        let mut to = bond_recipient.try_borrow_mut_lamports()?;
        transfer_bond_lamports(&mut from, &mut to, disposition.amount).map_err(into_pe)?;
    }
    {
        let mut data = challenge_info.try_borrow_mut_data()?;
        account
            .serialize(&mut &mut data[..])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
    }
    let pending = hooks.pending_split_gross;
    save_hold(hold_info, hooks.hold)?;
    // on_expired clears hold → write answers true.
    if pending.is_some() {
        close_answers_from_binding(
            program_id,
            binding,
            passport_config,
            answer_funder,
            answer_leave,
            answer_open,
            &token_id,
        )?;
    }
    if let Some(gross) = pending {
        pay_split_and_close(
            program_id,
            accounts,
            PaySplitIdx {
                consignment: 2,
                escrow: 6,
                platform: 7,
                seller: 8,
                agent: 9,
                system: 10,
                payer: 11,
                spl_start: 16,
            },
            &cfg,
            token_id,
            gross,
            CloseReason::HoldReleased,
        )?;
    }
    Ok(())
}

// ---- Pause / payment / bond / claim / warps ----

fn pause_ix(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let guardian = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    if !guardian.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (key, _) = config_pda(program_id);
    if config.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut asc = load_asc_config(config)?;
    let mut commerce = asc.as_commerce_config();
    pause(&mut commerce, &guardian.key.to_bytes()).map_err(into_pe)?;
    asc.paused = commerce.paused;
    save_asc_config(config, &asc)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &ConsignmentEvent::Paused {
            account: guardian.key.to_bytes(),
        },
    );
    Ok(())
}

fn unpause_ix(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let mut asc = load_asc_config(config)?;
    require_config_authority(authority, config, program_id, &asc.authority)?;
    let mut commerce = asc.as_commerce_config();
    unpause(&mut commerce);
    asc.paused = commerce.paused;
    save_asc_config(config, &asc)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &ConsignmentEvent::Unpaused {
            account: authority.key.to_bytes(),
        },
    );
    Ok(())
}

fn set_challenge_bond(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    challenge_bond: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    require_auction_rules_bond(challenge_bond)?;
    let mut cfg = load_asc_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    cfg.challenge_bond = challenge_bond;
    save_asc_config(config, &cfg)
}

fn approve_payment_token(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let mint = next_account_info(iter)?;
    let payment_token = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mint_key = mint.key.to_bytes();
    if mint_key == [0u8; 32] {
        return Err(into_pe(KargainError::ZeroAddress));
    }
    let cfg = load_asc_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    let decimals =
        require_admitted_spl_mint_account(mint.owner, &mint.try_borrow_data()?).map_err(into_pe)?;
    let (key, bump) = payment_token_pda(program_id, &mint_key);
    if payment_token.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    if payment_token.data_is_empty() {
        create_pda(
            program_id,
            payer,
            payment_token,
            system,
            PaymentTokenRecord::SPACE,
            &[PAYMENT_TOKEN_SEED, &mint_key, &[bump]],
        )?;
    }
    let rec = PaymentTokenRecord {
        discriminator: PAYMENT_TOKEN_DISC,
        mint: mint_key,
        enabled: true,
        decimals,
        bump,
    };
    let mut data = payment_token.try_borrow_mut_data()?;
    rec.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    generated::emit_ascending_consignment_payment_token_approved(mint_key);
    Ok(())
}

fn revoke_payment_token(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    mint: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let caller = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let payment_token = next_account_info(iter)?;
    if !caller.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_asc_config(config)?;
    if caller.key.to_bytes() != cfg.guardian && caller.key.to_bytes() != cfg.authority {
        return Err(into_pe(KargainError::NotGuardianOrOwner));
    }
    let (key, _) = payment_token_pda(program_id, &mint);
    if payment_token.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut rec = PaymentTokenRecord::try_from_slice(&payment_token.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    rec.enabled = false;
    let mut data = payment_token.try_borrow_mut_data()?;
    rec.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    generated::emit_ascending_consignment_payment_token_revoked(mint);
    Ok(())
}

fn withdraw_claim_ix(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let recipient = next_account_info(iter)?;
    let claim_info = next_account_info(iter)?;
    let claim_ata = next_account_info(iter)?;
    let dest_ata = next_account_info(iter)?;
    let mint = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;
    if !recipient.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (claim_key, claim_bump) = claim_pda(program_id, recipient.key, mint.key);
    if claim_info.key != &claim_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let (ata_key, _) = claim_ata_pda(program_id, recipient.key, mint.key);
    if claim_ata.key != &ata_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut claim = {
        let data = claim_info.try_borrow_data()?;
        ClaimAccount::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)?
    };
    let reachability =
        classify_spl_receive_reachability(Some(dest_ata), mint.key, token_program.key);
    if !matches!(reachability, SplReceiveReachability::Reachable) {
        return Err(into_pe(KargainError::TransferFailed));
    }
    let seeds: &[&[u8]] = &[
        CLAIM_SEED,
        recipient.key.as_ref(),
        mint.key.as_ref(),
        &[claim_bump],
    ];
    let claim_ata_key = *claim_ata.key;
    let dest_key = *dest_ata.key;
    let claim_key_copy = *claim_info.key;
    let ev = withdraw_claim(&mut claim, |amount| {
        invoke_signed(
            &spl_transfer(
                token_program.key,
                &claim_ata_key,
                &dest_key,
                &claim_key_copy,
                amount,
            ),
            &[
                claim_ata.clone(),
                dest_ata.clone(),
                claim_info.clone(),
                token_program.clone(),
            ],
            &[seeds],
        )
    })?;
    emit_payout(PayoutEmitter::AscendingConsignment, &ev);
    // D-23: close claim ATA then claim PDA — recipient reclaims rent.
    invoke_signed(
        &spl_close_account_ix(
            token_program.key,
            &claim_ata_key,
            recipient.key,
            &claim_key_copy,
        ),
        &[
            claim_ata.clone(),
            recipient.clone(),
            claim_info.clone(),
            token_program.clone(),
        ],
        &[seeds],
    )?;
    close_pda(claim_info, recipient)?;
    Ok(())
}

fn force_auction_ends_at(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    ends_at: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let auction_info = next_account_info(iter)?;
    let cfg = load_asc_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    let (akey, _) = auction_pda(program_id, &token_id);
    if auction_info.key != &akey {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut a = load_auction(auction_info)?;
    a.ends_at = ends_at;
    save_auction(auction_info, &a)
}

fn force_hold_clock(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    protection_ends_at: u64,
    frozen_remaining: u64,
    abandonment_deadline: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let hold_info = next_account_info(iter)?;
    let cfg = load_asc_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    let (hkey, _) = hold_pda(program_id, &token_id);
    if hold_info.key != &hkey {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut h = load_hold(hold_info)?;
    h.protection_ends_at = protection_ends_at;
    h.frozen_remaining = frozen_remaining;
    h.abandonment_deadline = abandonment_deadline;
    save_hold(hold_info, &h)
}

fn force_asset_owner(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _token_id: [u8; 32],
    _owner: [u8; 32],
) -> ProgramResult {
    refuse_harness(program_id, accounts)
}

fn pay_native_from_pda(from: &AccountInfo, to: &AccountInfo, amount: u64) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    let from_lamports = from.lamports();
    if from_lamports < amount {
        return Err(ProgramError::InsufficientFunds);
    }
    **from.try_borrow_mut_lamports()? -= amount;
    **to.try_borrow_mut_lamports()? += amount;
    Ok(())
}

fn pay_native<'a>(
    from: &AccountInfo<'a>,
    to: &AccountInfo<'a>,
    amount: u64,
    system: &AccountInfo<'a>,
) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    invoke(
        &system_instruction::transfer(from.key, to.key, amount),
        &[from.clone(), to.clone(), system.clone()],
    )
}

fn spl_transfer(
    token_program: &Pubkey,
    source: &Pubkey,
    dest: &Pubkey,
    authority: &Pubkey,
    amount: u64,
) -> solana_program::instruction::Instruction {
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    solana_program::instruction::Instruction {
        program_id: *token_program,
        accounts: vec![
            solana_program::instruction::AccountMeta::new(*source, false),
            solana_program::instruction::AccountMeta::new(*dest, false),
            solana_program::instruction::AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

fn pay_spl_leg_signed<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    escrow_ata: &AccountInfo<'a>,
    escrow_auth: &AccountInfo<'a>,
    escrow_seeds: &[&[u8]],
    recipient_wallet: &AccountInfo<'a>,
    recipient_ata: &AccountInfo<'a>,
    claim_info: &AccountInfo<'a>,
    claim_ata: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    amount: u64,
) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    let (claim_key, claim_bump) = claim_pda(program_id, recipient_wallet.key, mint.key);
    if claim_info.key != &claim_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let (ata_key, ata_bump) = claim_ata_pda(program_id, recipient_wallet.key, mint.key);
    if claim_ata.key != &ata_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let recipient_opt =
        if recipient_ata.data_is_empty() || recipient_ata.owner != token_program.key {
            None
        } else {
            Some(recipient_ata)
        };
    let reachability =
        classify_spl_receive_reachability(recipient_opt, mint.key, token_program.key);
    if matches!(reachability, SplReceiveReachability::Unreachable(_)) {
        ensure_claim(
            program_id,
            payer,
            claim_info,
            claim_ata,
            mint,
            token_program,
            system,
            recipient_wallet.key,
            claim_bump,
            ata_bump,
        )?;
    }
    let mut claim = if claim_info.data_is_empty() {
        ClaimAccount::new(
            recipient_wallet.key.to_bytes(),
            mint.key.to_bytes(),
            claim_bump,
        )
    } else {
        ClaimAccount::try_from_slice(&claim_info.try_borrow_data()?)
            .map_err(|_| ProgramError::InvalidAccountData)?
    };
    let escrow_key = *escrow_ata.key;
    let claim_ata_key = *claim_ata.key;
    let auth_key = *escrow_auth.key;
    let credited = pay_spl(
        &mut claim,
        amount,
        reachability,
        || {
            let dest = recipient_opt.ok_or(ProgramError::InvalidAccountData)?;
            invoke_signed(
                &spl_transfer(token_program.key, &escrow_key, dest.key, &auth_key, amount),
                &[
                    escrow_ata.clone(),
                    dest.clone(),
                    escrow_auth.clone(),
                    token_program.clone(),
                ],
                &[escrow_seeds],
            )
        },
        || {
            invoke_signed(
                &spl_transfer(
                    token_program.key,
                    &escrow_key,
                    &claim_ata_key,
                    &auth_key,
                    amount,
                ),
                &[
                    escrow_ata.clone(),
                    claim_ata.clone(),
                    escrow_auth.clone(),
                    token_program.clone(),
                ],
                &[escrow_seeds],
            )
        },
    )?;
    if let Some(ev) = credited {
        emit_payout(PayoutEmitter::AscendingConsignment, &ev);
        let mut data = claim_info.try_borrow_mut_data()?;
        claim
            .serialize(&mut &mut data[..])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
    }
    Ok(())
}

fn ensure_claim<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    claim_info: &AccountInfo<'a>,
    claim_ata: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    recipient: &Pubkey,
    claim_bump: u8,
    ata_bump: u8,
) -> ProgramResult {
    let rent = Rent::get()?;
    if claim_info.data_is_empty() {
        invoke_signed(
            &system_instruction::create_account(
                payer.key,
                claim_info.key,
                rent.minimum_balance(ClaimAccount::SPACE),
                ClaimAccount::SPACE as u64,
                program_id,
            ),
            &[payer.clone(), claim_info.clone(), system.clone()],
            &[&[
                CLAIM_SEED,
                recipient.as_ref(),
                mint.key.as_ref(),
                &[claim_bump],
            ]],
        )?;
        let claim = ClaimAccount::new(recipient.to_bytes(), mint.key.to_bytes(), claim_bump);
        let mut data = claim_info.try_borrow_mut_data()?;
        claim
            .serialize(&mut &mut data[..])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
    }
    if claim_ata.data_is_empty() {
        invoke_signed(
            &system_instruction::create_account(
                payer.key,
                claim_ata.key,
                rent.minimum_balance(SPL_TOKEN_ACCOUNT_LEN),
                SPL_TOKEN_ACCOUNT_LEN as u64,
                token_program.key,
            ),
            &[payer.clone(), claim_ata.clone(), system.clone()],
            &[&[
                CLAIM_ATA_SEED,
                recipient.as_ref(),
                mint.key.as_ref(),
                &[ata_bump],
            ]],
        )?;
        // InitializeAccount3 — owner = claim PDA (same as FixedPrice / money-harness).
        let mut data = vec![18u8];
        data.extend_from_slice(claim_info.key.as_ref());
        invoke(
            &solana_program::instruction::Instruction {
                program_id: *token_program.key,
                accounts: vec![
                    solana_program::instruction::AccountMeta::new(*claim_ata.key, false),
                    solana_program::instruction::AccountMeta::new_readonly(*mint.key, false),
                ],
                data,
            },
            &[claim_ata.clone(), mint.clone(), token_program.clone()],
        )?;
    }
    Ok(())
}


#[cfg(test)]
mod config_authority_handler_tests {
    use super::*;

    fn pid() -> Pubkey { Pubkey::new_from_array([11u8; 32]) }
    fn auth() -> Pubkey { Pubkey::new_from_array([1u8; 32]) }
    fn wrong() -> Pubkey { Pubkey::new_from_array([2u8; 32]) }

    fn cfg_bytes(program_id: &Pubkey, authority: &Pubkey) -> (Pubkey, Vec<u8>) {
        let (key, bump) = config_pda(program_id);
        let cfg = AscendingConfig {
            discriminator: ASC_CONFIG_DISC,
            authority: authority.to_bytes(),
            platform_recipient: [3u8; 32],
            platform_fee_bps: 100,
            guardian: [4u8; 32],
            paused: false,
            self_encumbrance_registered_retired: false,
            staking_program: [5u8; 32],
            forfeit_recipient: [6u8; 32],
            challenge_bond: 1,
            challenge_window: 100,
            challenge_configured: true,
            bump,
        };
        (key, borsh::to_vec(&cfg).unwrap())
    }

    fn auction_bytes(program_id: &Pubkey, token: &[u8; 32], ends_at: u64) -> (Pubkey, Vec<u8>) {
        let (key, bump) = auction_pda(program_id, token);
        let rec = AuctionTermsRecord {
            discriminator: AUCTION_DISC,
            token_id: *token,
            duration: MIN_DURATION,
            ends_at,
            extension_window: EXTENSION_WINDOW,
            protection_window: MIN_PROTECTION_WINDOW,
            abandonment_window: ABANDONMENT_WINDOW,
            min_increment_bps: MIN_INCREMENT_BPS,
            highest_bidder: [0u8; 32],
            highest_bid: 0,
            bump,
        };
        (key, borsh::to_vec(&rec).unwrap())
    }

    #[test]
    fn harness_ixs_retired() {
        let program_id = pid();
        let err = ProgramError::Custom(u32::from(KargainError::HarnessInstructionRetired));
        assert_eq!(create_asset(&program_id, &[], [0u8; 32]).unwrap_err(), err);
        assert_eq!(approve_escrow(&program_id, &[], [0u8; 32]).unwrap_err(), err);
        assert_eq!(set_may_open(&program_id, &[], [0u8; 32], true).unwrap_err(), err);
        assert_eq!(set_verified(&program_id, &[], [0u8; 32], true).unwrap_err(), err);
        assert_eq!(set_self_enc(&program_id, &[], true).unwrap_err(), err);
        assert_eq!(force_asset_owner(&program_id, &[], [0u8; 32], [0u8; 32]).unwrap_err(), err);
    }

    #[test]
    fn force_auction_ends_at_authority() {
        let program_id = pid();
        let authority = auth();
        let (cfg_key, mut cfg_data) = cfg_bytes(&program_id, &authority);
        let token = [10u8; 32];
        let (akey, mut auction_data) = auction_bytes(&program_id, &token, 100);
        let mut al = 0u64; let mut cl = 0u64; let mut aul = 0u64;
        {
            let a = AccountInfo::new(&authority, false, false, &mut al, &mut [], &program_id, false, 0);
            let c = AccountInfo::new(&cfg_key, false, false, &mut cl, &mut cfg_data, &program_id, false, 0);
            let u = AccountInfo::new(&akey, false, true, &mut aul, &mut auction_data, &program_id, false, 0);
            assert_eq!(force_auction_ends_at(&program_id, &[a, c, u], token, 50).unwrap_err(), ProgramError::MissingRequiredSignature);
        }
        {
            let a = AccountInfo::new(&authority, true, false, &mut al, &mut [], &program_id, false, 0);
            let c = AccountInfo::new(&cfg_key, false, false, &mut cl, &mut cfg_data, &program_id, false, 0);
            let u = AccountInfo::new(&akey, false, true, &mut aul, &mut auction_data, &program_id, false, 0);
            force_auction_ends_at(&program_id, &[a, c, u], token, 50).unwrap();
        }
        assert_eq!(AuctionTermsRecord::try_from_slice(&auction_data).unwrap().ends_at, 50);
    }

    #[test]
    fn unpause_and_set_challenge_bond() {
        let program_id = pid();
        let authority = auth();
        let (cfg_key, mut cfg_data) = cfg_bytes(&program_id, &authority);
        let mut loaded = AscendingConfig::try_from_slice(&cfg_data).unwrap();
        loaded.paused = true;
        cfg_data = borsh::to_vec(&loaded).unwrap();
        let mut al = 0u64; let mut cl = 0u64;
        {
            let w = wrong();
            let a = AccountInfo::new(&w, true, false, &mut al, &mut [], &program_id, false, 0);
            let c = AccountInfo::new(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id, false, 0);
            assert_eq!(
                unpause_ix(&program_id, &[a, c]).unwrap_err(),
                ProgramError::Custom(u32::from(KargainError::NotOwner)),
            );
        }
        {
            let a = AccountInfo::new(&authority, true, false, &mut al, &mut [], &program_id, false, 0);
            let c = AccountInfo::new(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id, false, 0);
            unpause_ix(&program_id, &[a, c]).unwrap();
        }
        assert!(!AscendingConfig::try_from_slice(&cfg_data).unwrap().paused);
        {
            let a = AccountInfo::new(&authority, true, false, &mut al, &mut [], &program_id, false, 0);
            let c = AccountInfo::new(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id, false, 0);
            set_challenge_bond(&program_id, &[a, c], 1).unwrap();
        }
        assert_eq!(AscendingConfig::try_from_slice(&cfg_data).unwrap().challenge_bond, 1);
    }
}
