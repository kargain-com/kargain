//! FixedPrice mode — asset + fiat (P4 two-layer; S6 #5 / S8-E step 5 / 6c).
//!
//! Custody = Core passport TransferV1 via `kargain-consignment-base::core_custody`.
//! Trust = passport `resolve_may_accounts` + registry (library, no CPI).
//! Obligation answers: created at open (`open_obligation`), closed with refund
//! at every close path (`close_obligation`) — sole owner `kargain-encumbrance`.
//! Harness CreateAsset / ApproveEscrow / SetMayOpen / SetSelfEncumbrance refuse
//! with `HarnessInstructionRetired`.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_agented_split::{agented_floor_scale_base, CompensationForm as SplitForm};
use kargain_claimable_payouts::{
    claim_ata_pda, claim_pda, classify_spl_receive_reachability, escrow_pda, pay_spl,
    require_admitted_spl_mint_account, require_full_delivery, spl_close_account_ix,
    spl_token_account_amount, verify_payout_recipient, withdraw_claim, ClaimAccount, CLAIM_ATA_SEED,
    CLAIM_SEED, ESCROW_SEED, SPL_TOKEN_ACCOUNT_LEN, PayoutAuthorities, PayoutLeg,
    SplReceiveReachability,
    emit::{emit_payout, PayoutEmitter},
};
use kargain_consignment_base::{
    agent_withdraw_ok, close_lot, compute_split_for_lot, config_pda, consignment_account_is_live,
    consignment_pda, core_asset_owner, custody_authority_pda, enter_committed_not_offered,
    force_recall_ready, grant_mandate, lower_commission, lower_floor, mandate_pda,
    owner_withdraw_ok, passport_binding_pda, pause, recall_account_is_requested,
    recall_account_requested_at, recall_pda, request_recall,
    require_agented_price_meets_floor, require_binding_uninitialised,
    require_bound_passport_program, require_config_authority, require_mandate_allows_open,
    require_not_paused, require_passport_core_asset, has_transfer_delegate, revoke_mandate,
    set_price, set_snapshot_floor, terminate_to_owner, transfer_custody_to_recipient,
    transfer_delegate_to_custody, transfer_owner_to_custody, unpause, write_open, CloseReason,
    CommerceConfig, Compensation, CompensationForm, ConsignmentRecord, Denomination,
    DenominationKind, MandateRecord, PassportBinding, RecallRecord, CONFIG_SEED, CONSIGNMENT_SEED,
    MANDATE_SEED, PASSPORT_BINDING_SEED,
    RECALL_DISCRIMINATOR, RECALL_SEED,
    emit::{
        emit_commerce, event_closed, event_commission_lowered, event_floor_lowered,
        event_mandate_granted, event_opened, event_price_set, event_split_paid, CommerceEmitter,
        ConsignmentEvent,
    },
};
use kargain_encumbrance::{
    close_obligation, open_obligation,
    INTENT_OPEN_CONSIGNMENT,
};
use kargain_errors::KargainError;
use kargain_events::generated;
use kargain_price::{
    fiat_usd_1e8_to_token_amount, read_price_update, MAX_FEED_STALENESS, MIN_FEED_STALENESS,
    PRICE_UPDATE_V2_LEN,
};
use kar_passport::may::{encumbrance_seed_prefix_for_source, resolve_may_accounts};
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

fn token_program_id() -> Pubkey {
    Pubkey::new_from_array([
        6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133,
        237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
    ])
}

const COMMERCE_EMITTER: CommerceEmitter = CommerceEmitter::FixedPriceConsignment;

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum FixedPriceIx {
    /// Accounts: payer · config · authority · platform · guardian · system
    InitConfig {
        platform_fee_bps: u16,
    },
    /// Retired — refuses with `HarnessInstructionRetired`.
    CreateAsset { token_id: [u8; 32] },
    /// Retired — refuses with `HarnessInstructionRetired`.
    ApproveEscrow { token_id: [u8; 32] },
    /// Retired — refuses with `HarnessInstructionRetired`.
    SetMayOpen { token_id: [u8; 32], allowed: bool },
    /// Retired — refuses with `HarnessInstructionRetired`.
    SetSelfEncumbrance { registered: bool },
    /// Mandate grant
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
    SetPrice { token_id: [u8; 32], new_price: u64 },
    LowerFloor { token_id: [u8; 32], new_floor: u64 },
    LowerCommission { token_id: [u8; 32], new_bps: u16 },
    RequestRecall { token_id: [u8; 32] },
    ForceRecall { token_id: [u8; 32] },
    OwnerWithdraw { token_id: [u8; 32] },
    AgentWithdraw { token_id: [u8; 32] },
    EnterCommitted { token_id: [u8; 32] },
    Pause,
    Unpause,
    /// Admit SPL payment mint. Zeros feed_id ⇒ asset-only; else pin price_program + bounds.
    ApprovePaymentToken {
        price_program: [u8; 32],
        feed_id: [u8; 32],
        staleness_tolerance: u32,
        max_confidence_bps: u32,
    },
    /// Soft-revoke: enabled=false; config retained for in-flight buy.
    RevokePaymentToken { mint: [u8; 32] },
    /// Buy: pull payment → custody to buyer → pay_split → Sold. Soft-revoke does **not** re-check enabled.
    Buy { token_id: [u8; 32] },
    SetSettlementNote { token_id: [u8; 32], note: [u8; 256], note_len: u32 },
    ConfirmExternalPayment { token_id: [u8; 32], buyer: [u8; 32] },
    /// Withdraw credited SPL claim (money owner under this program id).
    WithdrawClaim,
    /// Test: warp recall clock.
    ForceRecallRequestedAt {
        token_id: [u8; 32],
        requested_at: u64,
    },
    /// Test: seed lab PriceUpdateV2 bytes under PDA `["price-lab", feed_id]` (authority-gated).
    ForceSeedPriceAccount {
        feed_id: [u8; 32],
        data: [u8; PRICE_UPDATE_V2_LEN],
    },
    /// One-shot bind of passport program id into mode PDA.
    /// Accounts: authority(signer) · config · binding · passport_program(executable) · system · payer
    BindPassportProgram,
}

pub const PAYMENT_TOKEN_SEED: &[u8] = b"payment-token";
pub const NOTE_SEED: &[u8] = b"settlement-note";
pub const PRICE_LAB_SEED: &[u8] = b"price-lab";
pub const PAYMENT_TOKEN_DISC: [u8; 8] = *b"kp_fptk\0";
pub const NOTE_DISC: [u8; 8] = *b"kp_fpnt\0";

/// Solidity `bytes32("USD")` — right-padded.
pub const CURRENCY_USD: [u8; 32] = {
    let mut a = [0u8; 32];
    a[0] = b'U';
    a[1] = b'S';
    a[2] = b'D';
    a
};

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct PaymentTokenRecord {
    pub discriminator: [u8; 8],
    pub mint: [u8; 32],
    pub enabled: bool,
    pub decimals: u8,
    pub bump: u8,
    /// Zero program + zero feed_id ⇒ asset-only admission.
    pub price_program: [u8; 32],
    pub feed_id: [u8; 32],
    pub staleness_tolerance: u32,
    pub max_confidence_bps: u32,
}

impl PaymentTokenRecord {
    pub const SPACE: usize = 8 + 32 + 1 + 1 + 1 + 32 + 32 + 4 + 4;

    pub fn has_feed(&self) -> bool {
        self.feed_id != [0u8; 32]
    }
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct SettlementNoteRecord {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub note_len: u32,
    pub note: [u8; 256],
    pub bump: u8,
}

impl SettlementNoteRecord {
    pub const SPACE: usize = 8 + 32 + 4 + 256 + 1;
}

pub fn payment_token_pda(program_id: &Pubkey, mint: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PAYMENT_TOKEN_SEED, mint], program_id)
}

pub fn note_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[NOTE_SEED, token_id], program_id)
}

pub fn price_lab_pda(program_id: &Pubkey, feed_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PRICE_LAB_SEED, feed_id], program_id)
}

/// Retired harness may-flag type — deleted with Core migration.

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let ix = FixedPriceIx::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        FixedPriceIx::InitConfig { platform_fee_bps } => init_config(program_id, accounts, platform_fee_bps),
        FixedPriceIx::CreateAsset { token_id } => create_asset(program_id, accounts, token_id),
        FixedPriceIx::ApproveEscrow { token_id } => approve_escrow(program_id, accounts, token_id),
        FixedPriceIx::SetMayOpen { token_id, allowed } => set_may_open(program_id, accounts, token_id, allowed),
        FixedPriceIx::SetSelfEncumbrance { registered } => set_self_enc(program_id, accounts, registered),
        FixedPriceIx::Grant {
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
        FixedPriceIx::Revoke { token_id } => revoke(program_id, accounts, token_id),
        FixedPriceIx::OpenDirect {
            token_id,
            asset_mint,
            denom_kind,
            currency_code,
            price,
        } => open_direct(
            program_id,
            accounts,
            token_id,
            asset_mint,
            denom_kind,
            currency_code,
            price,
        ),
        FixedPriceIx::OpenFromMandate {
            token_id,
            denom_kind,
            currency_code,
            price,
        } => open_from_mandate(program_id, accounts, token_id, denom_kind, currency_code, price),
        FixedPriceIx::SetPrice { token_id, new_price } => set_price_ix(program_id, accounts, token_id, new_price),
        FixedPriceIx::LowerFloor { token_id, new_floor } => {
            lower_floor_ix(program_id, accounts, token_id, new_floor)
        }
        FixedPriceIx::LowerCommission { token_id, new_bps } => {
            lower_commission_ix(program_id, accounts, token_id, new_bps)
        }
        FixedPriceIx::RequestRecall { token_id } => request_recall_ix(program_id, accounts, token_id),
        FixedPriceIx::ForceRecall { token_id } => force_recall_ix(program_id, accounts, token_id),
        FixedPriceIx::OwnerWithdraw { token_id } => owner_withdraw_ix(program_id, accounts, token_id),
        FixedPriceIx::AgentWithdraw { token_id } => agent_withdraw_ix(program_id, accounts, token_id),
        FixedPriceIx::EnterCommitted { token_id } => enter_committed_ix(program_id, accounts, token_id),
        FixedPriceIx::Pause => pause_ix(program_id, accounts),
        FixedPriceIx::Unpause => unpause_ix(program_id, accounts),
        FixedPriceIx::ApprovePaymentToken {
            price_program,
            feed_id,
            staleness_tolerance,
            max_confidence_bps,
        } => approve_payment_token(
            program_id,
            accounts,
            price_program,
            feed_id,
            staleness_tolerance,
            max_confidence_bps,
        ),
        FixedPriceIx::RevokePaymentToken { mint } => revoke_payment_token(program_id, accounts, mint),
        FixedPriceIx::Buy { token_id } => buy(program_id, accounts, token_id),
        FixedPriceIx::SetSettlementNote {
            token_id,
            note,
            note_len,
        } => set_settlement_note(program_id, accounts, token_id, note, note_len),
        FixedPriceIx::ConfirmExternalPayment { token_id, buyer } => {
            confirm_external(program_id, accounts, token_id, buyer)
        }
        FixedPriceIx::WithdrawClaim => withdraw_claim_ix(program_id, accounts),
        FixedPriceIx::ForceRecallRequestedAt {
            token_id,
            requested_at,
        } => force_recall_at(program_id, accounts, token_id, requested_at),
        FixedPriceIx::ForceSeedPriceAccount { feed_id, data } => {
            force_seed_price_account(program_id, accounts, feed_id, data)
        }
        FixedPriceIx::BindPassportProgram => bind_passport_program(program_id, accounts),
    }
}

fn into_pe(e: KargainError) -> ProgramError {
    ProgramError::Custom(u32::from(e))
}

/// Mode open gate (after pause): Fiat requires pinned feed; SPL must be admitted+enabled.
fn require_mode_open(
    program_id: &Pubkey,
    denom: &Denomination,
    asset_mint: &[u8; 32],
    payment_token_info: Option<&AccountInfo>,
) -> Result<(), ProgramError> {
    let fiat = denom.kind == DenominationKind::Fiat as u8;
    if fiat {
        if denom.currency_code != CURRENCY_USD {
            // Non-USD currency feeds not configured on this MVP config.
            return Err(into_pe(KargainError::CurrencyNotAvailableOnChain));
        }
        if *asset_mint == [0u8; 32] {
            // Native USD feed not on CommerceConfig yet — refuse by name.
            return Err(into_pe(KargainError::CurrencyNotAvailableOnChain));
        }
    }
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
    if fiat && !rec.has_feed() {
        return Err(into_pe(KargainError::PaymentTokenFeedRequired));
    }
    Ok(())
}

fn load_config(info: &AccountInfo) -> Result<CommerceConfig, ProgramError> {
    let data = info.try_borrow_data()?;
    CommerceConfig::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)
}

fn save_config(info: &AccountInfo, cfg: &CommerceConfig) -> ProgramResult {
    let mut data = info.try_borrow_mut_data()?;
    cfg.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}

fn load_consignment(info: &AccountInfo) -> Result<ConsignmentRecord, ProgramError> {
    let data = info.try_borrow_data()?;
    ConsignmentRecord::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)
}

fn save_consignment(info: &AccountInfo, c: &ConsignmentRecord) -> ProgramResult {
    let mut data = info.try_borrow_mut_data()?;
    c.serialize(&mut &mut data[..])
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

fn set_self_enc(program_id: &Pubkey, accounts: &[AccountInfo], _registered: bool) -> ProgramResult {
    refuse_harness(program_id, accounts)
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
    let cfg = load_config(config)?;
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

fn init_config(program_id: &Pubkey, accounts: &[AccountInfo], fee_bps: u16) -> ProgramResult {
    let iter = &mut accounts.iter();
    let payer = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let platform = next_account_info(iter)?;
    let guardian = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    if !payer.is_signer || !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
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
        CommerceConfig::SPACE,
        &[CONFIG_SEED, &[bump]],
    )?;
    let cfg = CommerceConfig::new(
        authority.key.to_bytes(),
        platform.key.to_bytes(),
        fee_bps,
        guardian.key.to_bytes(),
        bump,
    )
    .map_err(into_pe)?;
    save_config(config, &cfg)
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

fn open_direct(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    asset_mint: [u8; 32],
    denom_kind: u8,
    currency_code: [u8; 32],
    price: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let seller = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    if !seller.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(config)?;
    require_not_paused(&cfg).map_err(into_pe)?;
    let denom = parse_denom(denom_kind, currency_code)?;
    let payment_tok = if asset_mint != [0u8; 32] {
        Some(next_account_info(iter)?)
    } else {
        None
    };
    require_mode_open(program_id, &denom, &asset_mint, payment_tok)?;

    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let challenge = next_account_info(iter)?;

    let passport_program = require_bound_passport_program(program_id, binding)?;
    let (seed_prefix, registry_len) =
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

    let consignment = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let is_live = consignment_account_is_live(consignment)?;
    if is_live {
        return Err(into_pe(KargainError::LiveConsignment));
    }

    let owner_pk = core_asset_owner(asset_info)?;
    if owner_pk != *seller.key {
        return Err(into_pe(KargainError::NotPassportOwner));
    }

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
        denom,
        0,
        Compensation::margin(),
        price,
        cfg.platform_fee_bps,
        now,
        bump,
    );
    save_consignment(consignment, &record)?;
    open_obligation(
        program_id,
        payer,
        answer_leave,
        answer_open,
        system,
        &seed_prefix,
        &token_id,
    )?;
    emit_commerce(COMMERCE_EMITTER, &event_opened(&record));
    Ok(())
}

fn open_from_mandate(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    denom_kind: u8,
    currency_code: [u8; 32],
    price: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let agent = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let mandate_info = next_account_info(iter)?;
    if !agent.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(config)?;
    require_not_paused(&cfg).map_err(into_pe)?;
    let m = {
        let data = mandate_info.try_borrow_data()?;
        MandateRecord::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)?
    };
    let now = Clock::get()?.unix_timestamp as u64;
    let denom = parse_denom(denom_kind, currency_code)?;
    require_mandate_allows_open(&m, &denom, now).map_err(into_pe)?;
    if m.agent != agent.key.to_bytes() {
        return Err(into_pe(KargainError::NotConsignmentAgent));
    }
    let payment_tok = if m.asset != [0u8; 32] {
        Some(next_account_info(iter)?)
    } else {
        None
    };
    require_mode_open(program_id, &m.denomination, &m.asset, payment_tok)?;

    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let challenge = next_account_info(iter)?;

    let passport_program = require_bound_passport_program(program_id, binding)?;
    let (seed_prefix, registry_len) =
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

    let consignment = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let is_live = consignment_account_is_live(consignment)?;
    if is_live {
        return Err(into_pe(KargainError::LiveConsignment));
    }
    require_agented_price_meets_floor(price, m.floor, m.compensation, cfg.platform_fee_bps)
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
        price,
        cfg.platform_fee_bps,
        now,
        bump,
    );
    save_consignment(consignment, &record)?;
    open_obligation(
        program_id,
        payer,
        answer_leave,
        answer_open,
        system,
        &seed_prefix,
        &token_id,
    )?;
    emit_commerce(COMMERCE_EMITTER, &event_opened(&record));
    Ok(())
}

fn set_price_ix(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    new_price: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let caller = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    if !caller.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (key, _) = consignment_pda(program_id, &token_id);
    if consignment.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut c = load_consignment(consignment)?;
    set_price(&mut c, &caller.key.to_bytes(), new_price).map_err(into_pe)?;
    save_consignment(consignment, &c)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &event_price_set(token_id, caller.key.to_bytes(), new_price),
    );
    Ok(())
}

fn lower_floor_ix(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    new_floor: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let caller = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    if !caller.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    // Passport owner for concessions = original seller on the lot (asset may be in custody).
    let c_check = load_consignment(consignment)?;
    let passport_owner = c_check.seller;
    let _ = asset_info;
    let (key, _) = consignment_pda(program_id, &token_id);
    if consignment.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut c = c_check;
    lower_floor(&mut c, &passport_owner, &caller.key.to_bytes(), new_floor).map_err(into_pe)?;
    save_consignment(consignment, &c)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &event_floor_lowered(token_id, new_floor),
    );
    Ok(())
}

fn lower_commission_ix(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    new_bps: u16,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let caller = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    if !caller.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (key, _) = consignment_pda(program_id, &token_id);
    if consignment.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut c = load_consignment(consignment)?;
    lower_commission(&mut c, &caller.key.to_bytes(), new_bps).map_err(into_pe)?;
    save_consignment(consignment, &c)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &event_commission_lowered(token_id, new_bps),
    );
    Ok(())
}

fn request_recall_ix(program_id: &Pubkey, accounts: &[AccountInfo], token_id: [u8; 32]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let seller = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !seller.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let c = load_consignment(consignment)?;
    let already = recall_account_is_requested(recall_info)?;
    let now = Clock::get()?.unix_timestamp as u64;
    let requested_at =
        request_recall(&c, &seller.key.to_bytes(), already, now).map_err(into_pe)?;
    let (rkey, rbump) = recall_pda(program_id, &token_id);
    if recall_info.key != &rkey {
        return Err(ProgramError::InvalidSeeds);
    }
    if recall_info.data_is_empty() {
        create_pda(
            program_id,
            payer,
            recall_info,
            system,
            RecallRecord::SPACE,
            &[RECALL_SEED, &token_id, &[rbump]],
        )?;
    }
    let rec = RecallRecord {
        discriminator: RECALL_DISCRIMINATOR,
        token_id,
        requested_at,
        bump: rbump,
    };
    let mut data = recall_info.try_borrow_mut_data()?;
    rec.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &ConsignmentEvent::RecallRequested {
            token_id,
            seller: seller.key.to_bytes(),
            requested_at,
        },
    );
    Ok(())
}

fn clear_recall(recall_info: &AccountInfo) -> ProgramResult {
    if recall_info.data_is_empty() {
        return Ok(());
    }
    let mut data = recall_info.try_borrow_mut_data()?;
    if let Ok(mut r) = RecallRecord::try_from_slice(&data) {
        r.requested_at = 0;
        r.serialize(&mut &mut data[..])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
    }
    Ok(())
}

fn force_recall_ix(program_id: &Pubkey, accounts: &[AccountInfo], token_id: [u8; 32]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let seller = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let recipient = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    let answer_funder = next_account_info(iter)?;
    if !seller.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut c = load_consignment(consignment)?;
    let requested_at = recall_account_requested_at(recall_info)?;
    let now = Clock::get()?.unix_timestamp as u64;
    force_recall_ready(&c, &seller.key.to_bytes(), requested_at, now).map_err(into_pe)?;
    clear_recall(recall_info)?;
    let seller_pk = c.seller;
    if recipient.key.to_bytes() != seller_pk {
        return Err(ProgramError::InvalidAccountData);
    }
    terminate_to_owner(&mut c, CloseReason::Recalled);

    let passport_program = require_bound_passport_program(program_id, binding)?;
    let (seed_prefix, _) =
        encumbrance_seed_prefix_for_source(passport_config, &passport_program, program_id)?;
    transfer_custody_to_recipient(
        program_id,
        &passport_program,
        &token_id,
        asset_info,
        custody,
        recipient,
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
    c.price = 0;
    c.floor = 0;
    save_consignment(consignment, &c)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &event_closed(token_id, CloseReason::Recalled),
    );
    Ok(())
}

fn force_recall_at(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    requested_at: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    let cfg = load_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    let (rkey, _) = recall_pda(program_id, &token_id);
    if recall_info.key != &rkey {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut r = RecallRecord::try_from_slice(&recall_info.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    r.requested_at = requested_at;
    let mut data = recall_info.try_borrow_mut_data()?;
    r.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}

fn owner_withdraw_ix(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let seller = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let recipient = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    let answer_funder = next_account_info(iter)?;
    if !seller.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut c = load_consignment(consignment)?;
    owner_withdraw_ok(&c, &seller.key.to_bytes()).map_err(into_pe)?;
    clear_recall(recall_info)?;
    let to = c.seller;
    if recipient.key.to_bytes() != to {
        return Err(ProgramError::InvalidAccountData);
    }
    terminate_to_owner(&mut c, CloseReason::Returned);

    let passport_program = require_bound_passport_program(program_id, binding)?;
    let (seed_prefix, _) =
        encumbrance_seed_prefix_for_source(passport_config, &passport_program, program_id)?;
    transfer_custody_to_recipient(
        program_id,
        &passport_program,
        &token_id,
        asset_info,
        custody,
        recipient,
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
    c.price = 0;
    save_consignment(consignment, &c)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &event_closed(token_id, CloseReason::Returned),
    );
    Ok(())
}

fn agent_withdraw_ix(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let agent = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let recipient = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    let answer_funder = next_account_info(iter)?;
    if !agent.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut c = load_consignment(consignment)?;
    agent_withdraw_ok(&c, &agent.key.to_bytes()).map_err(into_pe)?;
    clear_recall(recall_info)?;
    let to = c.seller;
    if recipient.key.to_bytes() != to {
        return Err(ProgramError::InvalidAccountData);
    }
    terminate_to_owner(&mut c, CloseReason::Returned);

    let passport_program = require_bound_passport_program(program_id, binding)?;
    let (seed_prefix, _) =
        encumbrance_seed_prefix_for_source(passport_config, &passport_program, program_id)?;
    transfer_custody_to_recipient(
        program_id,
        &passport_program,
        &token_id,
        asset_info,
        custody,
        recipient,
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
    c.price = 0;
    save_consignment(consignment, &c)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &event_closed(token_id, CloseReason::Returned),
    );
    Ok(())
}

fn enter_committed_ix(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let consignment = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    let (key, _) = consignment_pda(program_id, &token_id);
    if consignment.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut c = load_consignment(consignment)?;
    enter_committed_not_offered(&mut c).map_err(into_pe)?;
    clear_recall(recall_info)?;
    save_consignment(consignment, &c)
}

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
    let mut cfg = load_config(config)?;
    pause(&mut cfg, &guardian.key.to_bytes()).map_err(into_pe)?;
    save_config(config, &cfg)?;
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
    let mut cfg = load_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    unpause(&mut cfg);
    save_config(config, &cfg)?;
    emit_commerce(
        COMMERCE_EMITTER,
        &ConsignmentEvent::Unpaused {
            account: authority.key.to_bytes(),
        },
    );
    Ok(())
}

/// Buy (asset denom): pull → custody to buyer → pay_split → Sold.
/// Accounts (native): buyer(s) · config · consignment · asset · platform · seller · agent ·
///   recall · system · payer(s) · escrow_pda(w)
/// SPL append: buyer_ata · escrow_ata · mint · token_program ·
///   then per leg (platform/seller[/agent]): ata · claim · claim_ata
/// Soft-revoke: does **not** re-check payment-token enabled (D-31).
fn buy(program_id: &Pubkey, accounts: &[AccountInfo], token_id: [u8; 32]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let buyer = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let platform = next_account_info(iter)?;
    let seller_acc = next_account_info(iter)?;
    let agent_acc = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let escrow = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    let answer_funder = next_account_info(iter)?;
    if !buyer.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let passport_program = require_bound_passport_program(program_id, binding)?;
    let (seed_prefix, _) =
        encumbrance_seed_prefix_for_source(passport_config, &passport_program, program_id)?;
    let cfg = load_config(config)?;
    require_not_paused(&cfg).map_err(into_pe)?;
    let (ckey, _) = consignment_pda(program_id, &token_id);
    if consignment.key != &ckey {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut c = load_consignment(consignment)?;
    if !c.is_offered_actionable() {
        return Err(into_pe(KargainError::NotOffered));
    }

    let fiat = c.denomination.kind == DenominationKind::Fiat as u8;
    let native = c.asset == [0u8; 32];
    let amount = if fiat {
        if c.denomination.currency_code != CURRENCY_USD {
            return Err(into_pe(KargainError::CurrencyNotAvailableOnChain));
        }
        if native {
            return Err(into_pe(KargainError::CurrencyNotAvailableOnChain));
        }
        let payment_tok = next_account_info(iter)?;
        let price_acc = next_account_info(iter)?;
        let (pt_key, _) = payment_token_pda(program_id, &c.asset);
        if payment_tok.key != &pt_key {
            return Err(ProgramError::InvalidSeeds);
        }
        let rec = PaymentTokenRecord::try_from_slice(&payment_tok.try_borrow_data()?)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        if rec.mint != c.asset || !rec.has_feed() {
            return Err(into_pe(KargainError::PaymentTokenFeedRequired));
        }
        let now = Clock::get()?.unix_timestamp;
        let reading = read_price_update(
            &price_acc.try_borrow_data()?,
            &price_acc.owner.to_bytes(),
            &rec.price_program,
            &rec.feed_id,
            now,
            rec.staleness_tolerance,
            rec.max_confidence_bps,
        )
        .map_err(into_pe)?;
        fiat_usd_1e8_to_token_amount(c.price, &reading, rec.decimals).map_err(into_pe)?
    } else {
        c.price
    };

    // D-27: rewrite fiat agented floor to asset units before split.
    if fiat && c.agent != [0u8; 32] && c.floor != 0 {
        let form = match c.compensation.form_enum() {
            Some(CompensationForm::Margin) => SplitForm::Margin,
            Some(CompensationForm::Commission) => SplitForm::Commission,
            None => return Err(ProgramError::InvalidAccountData),
        };
        let fee = u64::from(c.platform_fee_bps);
        let base_fiat =
            agented_floor_scale_base(c.price, form, c.compensation.commission_bps, fee)
                .map_err(into_pe)?;
        let base_asset =
            agented_floor_scale_base(amount, form, c.compensation.commission_bps, fee)
                .map_err(into_pe)?;
        if base_fiat == 0 {
            return Err(into_pe(KargainError::BadOracleAnswer));
        }
        let floor_asset = ((u128::from(base_asset) * u128::from(c.floor)) / u128::from(base_fiat))
            as u64;
        set_snapshot_floor(&mut c, floor_asset).map_err(into_pe)?;
        save_consignment(consignment, &c)?;
    }

    let (escrow_key, escrow_bump) = escrow_pda(program_id, &token_id);
    if escrow.key != &escrow_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if escrow.data_is_empty() {
        // Lamport vault only (1-byte marker); SPL holds tokens in escrow ATA.
        create_pda(
            program_id,
            payer,
            escrow,
            system,
            1,
            &[ESCROW_SEED, &token_id, &[escrow_bump]],
        )?;
    }

    let mut spl_accounts: Option<(&AccountInfo, &AccountInfo, &AccountInfo)> = None;
    if native {
        pay_native(buyer, escrow, amount, system)?;
    } else {
        let buyer_ata = next_account_info(iter)?;
        let escrow_ata = next_account_info(iter)?;
        let mint = next_account_info(iter)?;
        let token_program = next_account_info(iter)?;
        if mint.key.to_bytes() != c.asset {
            return Err(ProgramError::InvalidAccountData);
        }
        // Soft-revoke: no enabled re-check (admission was at open).
        // Admit bans TransferFee; measured delivery is a separate rule (D-30) — fails closed
        // if a pull under-delivers (incl. admit regression).
        let before = spl_token_account_amount(&escrow_ata.try_borrow_data()?).map_err(into_pe)?;
        invoke(
            &spl_transfer(token_program.key, buyer_ata.key, escrow_ata.key, buyer.key, amount),
            &[
                buyer_ata.clone(),
                escrow_ata.clone(),
                buyer.clone(),
                token_program.clone(),
            ],
        )?;
        let after = spl_token_account_amount(&escrow_ata.try_borrow_data()?).map_err(into_pe)?;
        require_full_delivery(before, after, amount).map_err(into_pe)?;
        spl_accounts = Some((escrow_ata, mint, token_program));
    }

    let split = compute_split_for_lot(amount, &c).map_err(into_pe)?;
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

    // Custody to buyer AFTER pull, BEFORE pay_split (EVM order).
    transfer_custody_to_recipient(
        program_id,
        &passport_program,
        &token_id,
        asset_info,
        custody,
        buyer,
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

    if native {
        pay_native_from_pda(escrow, platform, split.platform)?;
        pay_native_from_pda(escrow, seller_acc, split.owner_amount)?;
        if split.agent_amount != 0 {
            pay_native_from_pda(escrow, agent_acc, split.agent_amount)?;
        }
    } else {
        let (escrow_ata, mint, token_program) = spl_accounts.ok_or(ProgramError::InvalidAccountData)?;
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

    clear_recall(recall_info)?;
    close_lot(&mut c, CloseReason::Sold);
    c.price = 0;
    c.floor = 0;
    save_consignment(consignment, &c)?;
    let payment_asset = if native { [0u8; 32] } else { c.asset };
    generated::emit_fixed_price_consignment_bought(
        token_id,
        buyer.key.to_bytes(),
        payment_asset,
        amount,
    );
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
        &event_closed(token_id, CloseReason::Sold),
    );
    Ok(())
}

fn pay_native_from_pda(
    from: &AccountInfo,
    to: &AccountInfo,
    amount: u64,
) -> ProgramResult {
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

/// SPL payout from mode escrow ATA; authority is escrow PDA (invoke_signed).
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
    if amount > 0 && matches!(reachability, SplReceiveReachability::Unreachable(_)) {
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
                &spl_transfer(token_program.key, &escrow_key, &claim_ata_key, &auth_key, amount),
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
        emit_payout(PayoutEmitter::FixedPriceConsignment, &ev);
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
        let mut data = vec![18u8];
        data.extend_from_slice(claim_info.key.as_ref());
        invoke(
            &solana_program::instruction::Instruction {
                program_id: token_program_id(),
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

/// Accounts: authority(s) · config · mint · payment_token · system · payer
fn approve_payment_token(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    price_program: [u8; 32],
    feed_id: [u8; 32],
    staleness_tolerance: u32,
    max_confidence_bps: u32,
) -> ProgramResult {
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
    let cfg = load_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    let decimals = require_admitted_spl_mint_account(mint.owner, &mint.try_borrow_data()?)
        .map_err(into_pe)?;
    let (key, bump) = payment_token_pda(program_id, &mint_key);
    if payment_token.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }

    let feed_zero = feed_id == [0u8; 32];
    if feed_zero {
        if staleness_tolerance != 0 {
            return Err(into_pe(KargainError::StalenessWithoutFeed));
        }
        if max_confidence_bps != 0 {
            return Err(into_pe(KargainError::StalenessWithoutFeed));
        }
        if price_program != [0u8; 32] {
            return Err(into_pe(KargainError::InvalidFeed));
        }
    } else {
        if price_program == [0u8; 32] {
            return Err(into_pe(KargainError::InvalidFeed));
        }
        if staleness_tolerance == 0 {
            return Err(into_pe(KargainError::ZeroFeedStaleness));
        }
        if staleness_tolerance < MIN_FEED_STALENESS || staleness_tolerance > MAX_FEED_STALENESS {
            return Err(into_pe(KargainError::FeedStalenessOutOfBounds));
        }
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
    } else {
        let existing = PaymentTokenRecord::try_from_slice(&payment_token.try_borrow_data()?)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        if existing.has_feed() && feed_zero {
            return Err(into_pe(KargainError::CannotClearPaymentTokenFeed));
        }
    }

    let rec = PaymentTokenRecord {
        discriminator: PAYMENT_TOKEN_DISC,
        mint: mint_key,
        enabled: true,
        decimals,
        bump,
        price_program: if feed_zero { [0u8; 32] } else { price_program },
        feed_id,
        staleness_tolerance: if feed_zero { 0 } else { staleness_tolerance },
        max_confidence_bps: if feed_zero { 0 } else { max_confidence_bps },
    };
    let mut data = payment_token.try_borrow_mut_data()?;
    rec.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    generated::emit_fixed_price_consignment_payment_token_approved(
        mint_key,
        feed_id,
        decimals,
        if feed_zero { 0 } else { staleness_tolerance },
    );
    Ok(())
}

/// Soft-revoke: enabled=false only (D-31).
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
    let cfg = load_config(config)?;
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
    generated::emit_fixed_price_consignment_payment_token_revoked(mint);
    Ok(())
}

fn set_settlement_note(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    note: [u8; 256],
    note_len: u32,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let caller = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let note_info = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !caller.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if note_len == 0 || note_len as usize > 256 {
        return Err(into_pe(KargainError::EmptySettlementNote));
    }
    let c = load_consignment(consignment)?;
    if !c.is_offered_actionable() {
        return Err(into_pe(KargainError::NotOffered));
    }
    if c.agent == [0u8; 32] {
        if c.seller != caller.key.to_bytes() {
            return Err(into_pe(KargainError::NotConsignmentSeller));
        }
    } else if c.agent != caller.key.to_bytes() {
        return Err(into_pe(KargainError::NotConsignmentRunner));
    }
    let (nkey, nbump) = note_pda(program_id, &token_id);
    if note_info.key != &nkey {
        return Err(ProgramError::InvalidSeeds);
    }
    if note_info.data_is_empty() {
        create_pda(
            program_id,
            payer,
            note_info,
            system,
            SettlementNoteRecord::SPACE,
            &[NOTE_SEED, &token_id, &[nbump]],
        )?;
    }
    let rec = SettlementNoteRecord {
        discriminator: NOTE_DISC,
        token_id,
        note_len,
        note,
        bump: nbump,
    };
    let mut data = note_info.try_borrow_mut_data()?;
    rec.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    generated::emit_fixed_price_consignment_settlement_note_set(
        token_id,
        caller.key.to_bytes(),
    );
    Ok(())
}

/// External confirm: custody to buyer, close ExternalConfirmed — no pay_split (D-32).
fn confirm_external(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    buyer: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let caller = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let note_info = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    let binding = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let buyer_acc = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let answer_leave = next_account_info(iter)?;
    let answer_open = next_account_info(iter)?;
    let answer_funder = next_account_info(iter)?;
    if !caller.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if buyer == [0u8; 32] {
        return Err(into_pe(KargainError::ZeroAddress));
    }
    if buyer_acc.key.to_bytes() != buyer {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut c = load_consignment(consignment)?;
    if !c.is_offered_actionable() {
        return Err(into_pe(KargainError::NotOffered));
    }
    if caller.key.to_bytes() != c.seller && caller.key.to_bytes() != c.agent {
        return Err(into_pe(KargainError::NotSellerOrAgent));
    }
    let note = SettlementNoteRecord::try_from_slice(&note_info.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if note.note_len == 0 {
        return Err(into_pe(KargainError::EmptySettlementNote));
    }
    let mut cleared = note;
    cleared.note_len = 0;
    cleared.note = [0u8; 256];
    {
        let mut data = note_info.try_borrow_mut_data()?;
        cleared
            .serialize(&mut &mut data[..])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
    }

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
    close_obligation(
        program_id,
        answer_funder,
        answer_leave,
        answer_open,
        &seed_prefix,
        &token_id,
    )?;

    clear_recall(recall_info)?;
    close_lot(&mut c, CloseReason::ExternalConfirmed);
    c.price = 0;
    c.floor = 0;
    save_consignment(consignment, &c)?;
    generated::emit_fixed_price_consignment_external_payment_confirmed(
        token_id,
        buyer,
        caller.key.to_bytes(),
    );
    emit_commerce(
        COMMERCE_EMITTER,
        &event_closed(token_id, CloseReason::ExternalConfirmed),
    );
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
            &spl_transfer(token_program.key, &claim_ata_key, &dest_key, &claim_key_copy, amount),
            &[
                claim_ata.clone(),
                dest_ata.clone(),
                claim_info.clone(),
                token_program.clone(),
            ],
            &[seeds],
        )
    })?;
    emit_payout(PayoutEmitter::FixedPriceConsignment, &ev);
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
    {
        let lamports = claim_info.lamports();
        **claim_info.try_borrow_mut_lamports()? = 0;
        **recipient.try_borrow_mut_lamports()? = recipient
            .lamports()
            .checked_add(lamports)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        claim_info.try_borrow_mut_data()?.fill(0);
        claim_info.assign(&system_program::ID);
    }
    Ok(())
}

/// Authority-gated lab seed: write 134-byte PriceUpdateV2 layout to PDA owned by this program.
/// LIVE admits with `price_program = FixedPrice program id`. Production pins the real receiver.
fn force_seed_price_account(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    feed_id: [u8; 32],
    data: [u8; PRICE_UPDATE_V2_LEN],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let price_info = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(config)?;
    require_config_authority(authority, config, program_id, &cfg.authority)?;
    if feed_id == [0u8; 32] {
        return Err(into_pe(KargainError::InvalidFeed));
    }
    let (key, bump) = price_lab_pda(program_id, &feed_id);
    if price_info.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    if price_info.data_is_empty() {
        create_pda(
            program_id,
            payer,
            price_info,
            system,
            PRICE_UPDATE_V2_LEN,
            &[PRICE_LAB_SEED, &feed_id, &[bump]],
        )?;
    }
    if price_info.data_len() < PRICE_UPDATE_V2_LEN {
        return Err(ProgramError::AccountDataTooSmall);
    }
    let mut dst = price_info.try_borrow_mut_data()?;
    dst[..PRICE_UPDATE_V2_LEN].copy_from_slice(&data);
    Ok(())
}


#[cfg(test)]
mod config_authority_handler_tests {
    use super::*;

    fn pid() -> Pubkey {
        Pubkey::new_from_array([9u8; 32])
    }
    fn auth() -> Pubkey {
        Pubkey::new_from_array([1u8; 32])
    }
    fn wrong() -> Pubkey {
        Pubkey::new_from_array([2u8; 32])
    }

    fn cfg_bytes(program_id: &Pubkey, authority: &Pubkey) -> (Pubkey, Vec<u8>) {
        let (key, bump) = config_pda(program_id);
        let cfg =
            CommerceConfig::new(authority.to_bytes(), [3u8; 32], 100, [4u8; 32], bump).unwrap();
        (key, borsh::to_vec(&cfg).unwrap())
    }

    fn recall_bytes(program_id: &Pubkey, token: &[u8; 32]) -> (Pubkey, Vec<u8>) {
        let (key, bump) = recall_pda(program_id, token);
        let r = RecallRecord {
            discriminator: RECALL_DISCRIMINATOR,
            token_id: *token,
            requested_at: 1,
            bump,
        };
        (key, borsh::to_vec(&r).unwrap())
    }

    #[test]
    fn retired_harness_variants_refuse_by_name() {
        let program_id = pid();
        let token = [7u8; 32];
        let err = ProgramError::Custom(u32::from(KargainError::HarnessInstructionRetired));
        assert_eq!(create_asset(&program_id, &[], token).unwrap_err(), err);
        assert_eq!(approve_escrow(&program_id, &[], token).unwrap_err(), err);
        assert_eq!(set_may_open(&program_id, &[], token, true).unwrap_err(), err);
        assert_eq!(set_self_enc(&program_id, &[], true).unwrap_err(), err);
    }

    #[test]
    fn unbound_binding_refuses_passport_program_unbound() {
        let program_id = pid();
        let (bkey, _) = passport_binding_pda(&program_id);
        let mut lamports = 0u64;
        let mut data = vec![];
        let system = system_program::ID;
        let info = AccountInfo::new(
            &bkey,
            false,
            false,
            &mut lamports,
            &mut data,
            &system,
            false,
            0,
        );
        assert_eq!(
            require_bound_passport_program(&program_id, &info).unwrap_err(),
            ProgramError::Custom(u32::from(KargainError::PassportProgramUnbound)),
        );
    }

    #[test]
    fn mode_owned_wrong_disc_binding_refuses_unbound() {
        let program_id = pid();
        let (bkey, _) = passport_binding_pda(&program_id);
        let mut lamports = 1u64;
        let mut data = vec![0u8; PassportBinding::SPACE];
        data[..8].copy_from_slice(b"notpbind");
        let info = AccountInfo::new(
            &bkey,
            false,
            false,
            &mut lamports,
            &mut data,
            &program_id,
            false,
            0,
        );
        assert_eq!(
            require_bound_passport_program(&program_id, &info).unwrap_err(),
            ProgramError::Custom(u32::from(KargainError::PassportProgramUnbound)),
        );
    }

    #[test]
    fn answer_signer_seeds_match_shared_derivation() {
        use kargain_encumbrance::{
            derive_encumbrance_answer_pda, encumbrance_answer_signer_seeds, INTENT_LEAVE_CHAIN,
        };
        let program_id = pid();
        let token = [9u8; 32];
        let seed = b"fp";
        let (expected, bump) =
            derive_encumbrance_answer_pda(&program_id, seed, &token, INTENT_LEAVE_CHAIN).unwrap();
        let intent_seed = [INTENT_LEAVE_CHAIN];
        let bump_seed = [bump];
        let from_signer = Pubkey::create_program_address(
            &encumbrance_answer_signer_seeds(seed, &token, &intent_seed, &bump_seed),
            &program_id,
        )
        .unwrap();
        assert_eq!(expected, from_signer);
        // Diverged plant (token before prefix) must not match.
        let diverged: [&[u8]; 4] = [
            token.as_ref(),
            seed,
            intent_seed.as_ref(),
            bump_seed.as_ref(),
        ];
        if let Ok(pk) = Pubkey::create_program_address(&diverged, &program_id) {
            assert_ne!(pk, expected);
        }
    }

    #[test]
    fn force_recall_at_unsigned_wrong_correct() {
        let program_id = pid();
        let authority = auth();
        let (cfg_key, mut cfg_data) = cfg_bytes(&program_id, &authority);
        let token = [8u8; 32];
        let (rkey, mut rdata) = recall_bytes(&program_id, &token);
        let mut al = 0u64;
        let mut cl = 0u64;
        let mut rl = 0u64;
        {
            let a =
                AccountInfo::new(&authority, false, false, &mut al, &mut [], &program_id, false, 0);
            let c = AccountInfo::new(
                &cfg_key,
                false,
                false,
                &mut cl,
                &mut cfg_data,
                &program_id,
                false,
                0,
            );
            let r =
                AccountInfo::new(&rkey, false, true, &mut rl, &mut rdata, &program_id, false, 0);
            assert_eq!(
                force_recall_at(&program_id, &[a, c, r], token, 99).unwrap_err(),
                ProgramError::MissingRequiredSignature
            );
        }
        {
            let w = wrong();
            let a = AccountInfo::new(&w, true, false, &mut al, &mut [], &program_id, false, 0);
            let c = AccountInfo::new(
                &cfg_key,
                false,
                false,
                &mut cl,
                &mut cfg_data,
                &program_id,
                false,
                0,
            );
            let r =
                AccountInfo::new(&rkey, false, true, &mut rl, &mut rdata, &program_id, false, 0);
            assert_eq!(
                force_recall_at(&program_id, &[a, c, r], token, 99).unwrap_err(),
                ProgramError::Custom(u32::from(KargainError::NotOwner)),
            );
        }
        {
            let a =
                AccountInfo::new(&authority, true, false, &mut al, &mut [], &program_id, false, 0);
            let c = AccountInfo::new(
                &cfg_key,
                false,
                false,
                &mut cl,
                &mut cfg_data,
                &program_id,
                false,
                0,
            );
            let r =
                AccountInfo::new(&rkey, false, true, &mut rl, &mut rdata, &program_id, false, 0);
            force_recall_at(&program_id, &[a, c, r], token, 42).unwrap();
        }
        assert_eq!(
            RecallRecord::try_from_slice(&rdata).unwrap().requested_at,
            42
        );
    }

    #[test]
    fn unpause_still_authority_gated() {
        let program_id = pid();
        let authority = auth();
        let (cfg_key, mut cfg_data) = cfg_bytes(&program_id, &authority);
        let mut loaded = CommerceConfig::try_from_slice(&cfg_data).unwrap();
        loaded.paused = true;
        cfg_data = borsh::to_vec(&loaded).unwrap();
        let mut al = 0u64;
        let mut cl = 0u64;
        {
            let a =
                AccountInfo::new(&authority, true, false, &mut al, &mut [], &program_id, false, 0);
            let c = AccountInfo::new(
                &cfg_key,
                false,
                true,
                &mut cl,
                &mut cfg_data,
                &program_id,
                false,
                0,
            );
            unpause_ix(&program_id, &[a, c]).unwrap();
        }
        assert!(!CommerceConfig::try_from_slice(&cfg_data).unwrap().paused);
    }
}

