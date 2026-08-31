//! FixedPrice mode — asset denomination only (S6 #3b).
//! Custody via HarnessAsset ownership-move (D-25 harness path); Core TransferV1 when passport-wired.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_claimable_payouts::{
    claim_ata_pda, claim_pda, classify_spl_receive_reachability, escrow_pda, pay_spl,
    require_full_delivery, verify_payout_recipient, withdraw_claim, ClaimAccount, CLAIM_ATA_SEED,
    CLAIM_SEED, ESCROW_SEED, SPL_TOKEN_ACCOUNT_LEN, PayoutAuthorities, PayoutLeg,
    SplReceiveReachability,
};
use kargain_consignment_base::{
    agent_withdraw_ok, asset_pda, close_lot, compute_split_for_lot, config_pda, consignment_pda,
    custody_authority_pda, enter_committed_not_offered, force_recall_ready, grant_mandate,
    is_escrow_approved, lower_commission, lower_floor, mandate_pda, owner_withdraw_ok, pause,
    recall_pda, release_custody, request_recall, require_agented_price_meets_floor,
    require_can_open, require_mandate_allows_open, require_not_paused, revoke_mandate,
    set_price, take_custody, terminate_to_owner, unpause, write_open, CloseReason,
    CommerceConfig, Compensation, CompensationForm, ConsignmentRecord, Denomination,
    DenominationKind, HarnessAsset, MandateRecord, RecallRecord, ASSET_DISCRIMINATOR, ASSET_SEED,
    CONFIG_SEED, CONSIGNMENT_SEED, MANDATE_SEED, RECALL_DISCRIMINATOR, RECALL_SEED,
};
use kargain_errors::KargainError;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

fn token_program_id() -> Pubkey {
    Pubkey::new_from_array([
        6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133,
        237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
    ])
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum FixedPriceIx {
    /// Accounts: payer · config · authority · platform · guardian · system
    InitConfig {
        platform_fee_bps: u16,
    },
    /// Accounts: payer · asset · owner · system — create harness asset owned by owner
    CreateAsset { token_id: [u8; 32] },
    /// Accounts: owner(signer) · asset · spender — set TransferDelegate analogue
    ApproveEscrow { token_id: [u8; 32] },
    /// Accounts: owner · asset · may_flag (ignored) — harness stub: set may via config bit on asset approved
    SetMayOpen { token_id: [u8; 32], allowed: bool },
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
    /// Approve SPL payment mint (asset-only — no feed).
    ApprovePaymentToken { mint: [u8; 32], decimals: u8 },
    /// Soft-revoke: enabled=false; config retained for in-flight buy.
    RevokePaymentToken { mint: [u8; 32] },
    /// Buy: pull payment → custody to buyer → pay_split → Sold. Soft-revoke does **not** re-check enabled.
    /// `transfer_fee` is for Token-2022 TransferCheckedWithFee (0 = classic SPL Transfer).
    Buy {
        token_id: [u8; 32],
        transfer_fee: u64,
    },
    SetSettlementNote { token_id: [u8; 32], note: [u8; 256], note_len: u32 },
    ConfirmExternalPayment { token_id: [u8; 32], buyer: [u8; 32] },
    /// Withdraw credited SPL claim (money owner under this program id).
    WithdrawClaim,
    /// Test: warp recall clock.
    ForceRecallRequestedAt {
        token_id: [u8; 32],
        requested_at: u64,
    },
}

pub const PAYMENT_TOKEN_SEED: &[u8] = b"payment-token";
pub const NOTE_SEED: &[u8] = b"settlement-note";
pub const PAYMENT_TOKEN_DISC: [u8; 8] = *b"kp_fptk\0";
pub const NOTE_DISC: [u8; 8] = *b"kp_fpnt\0";

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

/// Per-asset may_open flag stored beside asset (harness stub for passport may).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct MayOpenFlag {
    pub allowed: bool,
}

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
        FixedPriceIx::ApprovePaymentToken { mint, decimals } => {
            approve_payment_token(program_id, accounts, mint, decimals)
        }
        FixedPriceIx::RevokePaymentToken { mint } => revoke_payment_token(program_id, accounts, mint),
        FixedPriceIx::Buy {
            token_id,
            transfer_fee,
        } => buy(program_id, accounts, token_id, transfer_fee),
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
    }
}

fn into_pe(e: KargainError) -> ProgramError {
    ProgramError::Custom(u32::from(e))
}

/// Mode open gate: Fiat refused first (D-29), then SPL must be admitted+enabled.
/// Call after pause check; before require_can_open / custody / write_open.
fn require_mode_open(
    program_id: &Pubkey,
    denom: &Denomination,
    asset_mint: &[u8; 32],
    payment_token_info: Option<&AccountInfo>,
) -> Result<(), ProgramError> {
    if denom.kind == DenominationKind::Fiat as u8 {
        return Err(into_pe(KargainError::FiatDenominationRefused));
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
    Ok(())
}

fn spl_token_amount(ata: &AccountInfo) -> Result<u64, ProgramError> {
    let data = ata.try_borrow_data()?;
    if data.len() < SPL_TOKEN_ACCOUNT_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&data[64..72]);
    Ok(u64::from_le_bytes(buf))
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

fn load_asset(info: &AccountInfo) -> Result<HarnessAsset, ProgramError> {
    let data = info.try_borrow_data()?;
    if data.len() < HarnessAsset::SPACE {
        return Err(ProgramError::InvalidAccountData);
    }
    HarnessAsset::try_from_slice(&data[..HarnessAsset::SPACE])
        .map_err(|_| ProgramError::InvalidAccountData)
}

fn save_asset(info: &AccountInfo, a: &HarnessAsset) -> ProgramResult {
    let mut data = info.try_borrow_mut_data()?;
    a.serialize(&mut &mut data[..])
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

fn create_asset(program_id: &Pubkey, accounts: &[AccountInfo], token_id: [u8; 32]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let payer = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let owner = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (key, bump) = asset_pda(program_id, &token_id);
    if asset.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    // Space: HarnessAsset + 1 byte may_open at end
    let space = HarnessAsset::SPACE + 1;
    create_pda(
        program_id,
        payer,
        asset,
        system,
        space,
        &[ASSET_SEED, &token_id, &[bump]],
    )?;
    let a = HarnessAsset {
        discriminator: ASSET_DISCRIMINATOR,
        token_id,
        owner: owner.key.to_bytes(),
        approved_for: [0u8; 32],
        bump,
    };
    {
        let mut data = asset.try_borrow_mut_data()?;
        a.serialize(&mut &mut data[..HarnessAsset::SPACE])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
        data[HarnessAsset::SPACE] = 1; // may_open default true
    }
    Ok(())
}

fn read_may_open(asset: &AccountInfo) -> bool {
    let data = asset.try_borrow_data().ok();
    match data {
        Some(d) if d.len() > HarnessAsset::SPACE => d[HarnessAsset::SPACE] != 0,
        _ => true,
    }
}

fn write_may_open(asset: &AccountInfo, allowed: bool) -> ProgramResult {
    let mut data = asset.try_borrow_mut_data()?;
    if data.len() <= HarnessAsset::SPACE {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[HarnessAsset::SPACE] = u8::from(allowed);
    Ok(())
}

fn approve_escrow(program_id: &Pubkey, accounts: &[AccountInfo], token_id: [u8; 32]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let owner = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let spender = next_account_info(iter)?;
    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (key, _) = asset_pda(program_id, &token_id);
    if asset_info.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut a = load_asset(asset_info)?;
    if a.owner != owner.key.to_bytes() {
        return Err(into_pe(KargainError::NotPassportOwner));
    }
    a.approved_for = spender.key.to_bytes();
    // Preserve may flag
    let may = read_may_open(asset_info);
    save_asset(asset_info, &a)?;
    write_may_open(asset_info, may)
}

fn set_may_open(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    allowed: bool,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let _authority = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let (key, _) = asset_pda(program_id, &token_id);
    if asset_info.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    write_may_open(asset_info, allowed)
}

fn set_self_enc(program_id: &Pubkey, accounts: &[AccountInfo], registered: bool) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (key, _) = config_pda(program_id);
    if config.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut cfg = load_config(config)?;
    if cfg.authority != authority.key.to_bytes() {
        return Err(into_pe(KargainError::NotGuardianOrOwner));
    }
    cfg.self_encumbrance_registered = registered;
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
    let asset_info = next_account_info(iter)?;
    let mandate_info = next_account_info(iter)?;
    let consignment_info = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !owner.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (asset_key, _) = asset_pda(program_id, &token_id);
    if asset_info.key != &asset_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let a = load_asset(asset_info)?;
    let (cust_key, _) = custody_authority_pda(program_id);
    if custody.key != &cust_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let is_live = !consignment_info.data_is_empty()
        && load_consignment(consignment_info)
            .map(|c| c.is_live())
            .unwrap_or(false);
    let approved = is_escrow_approved(&a, &cust_key.to_bytes());
    let denom = parse_denom(denom_kind, currency_code)?;
    let comp = parse_comp(form, commission_bps)?;
    let (mkey, mbump) = mandate_pda(program_id, &token_id);
    if mandate_info.key != &mkey {
        return Err(ProgramError::InvalidSeeds);
    }
    let record = grant_mandate(
        token_id,
        &a.owner,
        &owner.key.to_bytes(),
        is_live,
        approved,
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
    Ok(())
}

fn revoke(program_id: &Pubkey, accounts: &[AccountInfo], token_id: [u8; 32]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let owner = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let mandate_info = next_account_info(iter)?;
    let consignment_info = next_account_info(iter)?;
    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let a = load_asset(asset_info)?;
    let m = {
        let data = mandate_info.try_borrow_data()?;
        MandateRecord::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)?
    };
    let is_live = !consignment_info.data_is_empty()
        && load_consignment(consignment_info)
            .map(|c| c.is_live())
            .unwrap_or(false);
    revoke_mandate(&m, &a.owner, &owner.key.to_bytes(), is_live).map_err(into_pe)?;
    // Zero active
    let mut cleared = m;
    cleared.active = false;
    let mut data = mandate_info.try_borrow_mut_data()?;
    cleared
        .serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    let _ = program_id;
    let _ = token_id;
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
    let asset_info = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !seller.is_signer || !payer.is_signer {
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
    let mut a = load_asset(asset_info)?;
    if a.owner != seller.key.to_bytes() {
        return Err(into_pe(KargainError::NotPassportOwner));
    }
    let (cust_key, cust_bump) = custody_authority_pda(program_id);
    if custody.key != &cust_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let is_live = !consignment.data_is_empty()
        && load_consignment(consignment)
            .map(|c| c.is_live())
            .unwrap_or(false);
    require_can_open(
        cfg.self_encumbrance_registered,
        read_may_open(asset_info),
        is_live,
        is_escrow_approved(&a, &cust_key.to_bytes()),
    )
    .map_err(into_pe)?;

    let bump = ensure_consignment_account(program_id, payer, consignment, system, &token_id)?;
    take_custody(&mut a, &seller.key.to_bytes(), &cust_key.to_bytes()).map_err(into_pe)?;
    let may = read_may_open(asset_info);
    save_asset(asset_info, &a)?;
    write_may_open(asset_info, may)?;

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
    let _ = cust_bump;
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
    let asset_info = next_account_info(iter)?;
    let mandate_info = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let custody = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !agent.is_signer || !payer.is_signer {
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
    // Fiat refuse uses mandate denomination (open gate), not only ix denom.
    require_mode_open(program_id, &m.denomination, &m.asset, payment_tok)?;
    let mut a = load_asset(asset_info)?;
    let (cust_key, _) = custody_authority_pda(program_id);
    if custody.key != &cust_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let is_live = !consignment.data_is_empty()
        && load_consignment(consignment)
            .map(|c| c.is_live())
            .unwrap_or(false);
    require_can_open(
        cfg.self_encumbrance_registered,
        read_may_open(asset_info),
        is_live,
        is_escrow_approved(&a, &cust_key.to_bytes()),
    )
    .map_err(into_pe)?;
    require_agented_price_meets_floor(price, m.floor, m.compensation, cfg.platform_fee_bps)
        .map_err(into_pe)?;

    let bump = ensure_consignment_account(program_id, payer, consignment, system, &token_id)?;
    let seller = a.owner;
    take_custody(&mut a, &seller, &cust_key.to_bytes()).map_err(into_pe)?;
    let may = read_may_open(asset_info);
    save_asset(asset_info, &a)?;
    write_may_open(asset_info, may)?;

    let record = write_open(
        token_id,
        seller,
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
    save_consignment(consignment, &record)
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
    save_consignment(consignment, &c)
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
    save_consignment(consignment, &c)
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
    save_consignment(consignment, &c)
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
    let already = !recall_info.data_is_empty()
        && RecallRecord::try_from_slice(&recall_info.try_borrow_data()?)
            .map(|r| r.requested_at != 0)
            .unwrap_or(false);
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
    let asset_info = next_account_info(iter)?;
    if !seller.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut c = load_consignment(consignment)?;
    let requested_at = if recall_info.data_is_empty() {
        0
    } else {
        RecallRecord::try_from_slice(&recall_info.try_borrow_data()?)
            .map(|r| r.requested_at)
            .unwrap_or(0)
    };
    let now = Clock::get()?.unix_timestamp as u64;
    force_recall_ready(&c, &seller.key.to_bytes(), requested_at, now).map_err(into_pe)?;
    clear_recall(recall_info)?;
    let seller_pk = c.seller;
    terminate_to_owner(&mut c, CloseReason::Recalled);
    let mut a = load_asset(asset_info)?;
    release_custody(&mut a, seller_pk);
    let may = read_may_open(asset_info);
    save_asset(asset_info, &a)?;
    write_may_open(asset_info, may)?;
    // Clear commercial fields but keep phase Returned readable
    c.price = 0;
    c.floor = 0;
    save_consignment(consignment, &c)?;
    let _ = program_id;
    let _ = token_id;
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
    let recall_info = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
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
    let asset_info = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    if !seller.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut c = load_consignment(consignment)?;
    owner_withdraw_ok(&c, &seller.key.to_bytes()).map_err(into_pe)?;
    clear_recall(recall_info)?;
    let to = c.seller;
    terminate_to_owner(&mut c, CloseReason::Returned);
    let mut a = load_asset(asset_info)?;
    release_custody(&mut a, to);
    let may = read_may_open(asset_info);
    save_asset(asset_info, &a)?;
    write_may_open(asset_info, may)?;
    c.price = 0;
    save_consignment(consignment, &c)?;
    let _ = (program_id, token_id);
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
    let asset_info = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    if !agent.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut c = load_consignment(consignment)?;
    agent_withdraw_ok(&c, &agent.key.to_bytes()).map_err(into_pe)?;
    clear_recall(recall_info)?;
    let to = c.seller;
    terminate_to_owner(&mut c, CloseReason::Returned);
    let mut a = load_asset(asset_info)?;
    release_custody(&mut a, to);
    let may = read_may_open(asset_info);
    save_asset(asset_info, &a)?;
    write_may_open(asset_info, may)?;
    c.price = 0;
    save_consignment(consignment, &c)?;
    let _ = (program_id, token_id);
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
    save_config(config, &cfg)
}

fn unpause_ix(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (key, _) = config_pda(program_id);
    if config.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut cfg = load_config(config)?;
    if cfg.authority != authority.key.to_bytes() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    unpause(&mut cfg);
    save_config(config, &cfg)
}

/// Buy (asset denom): pull → custody to buyer → pay_split → Sold.
/// Accounts (native): buyer(s) · config · consignment · asset · platform · seller · agent ·
///   recall · system · payer(s) · escrow_pda(w)
/// SPL append: buyer_ata · escrow_ata · mint · token_program ·
///   then per leg (platform/seller[/agent]): ata · claim · claim_ata
/// Soft-revoke: does **not** re-check payment-token enabled (D-31).
fn buy(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    transfer_fee: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let buyer = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let platform = next_account_info(iter)?;
    let seller_acc = next_account_info(iter)?;
    let agent_acc = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let escrow = next_account_info(iter)?;
    if !buyer.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
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
    let amount = c.price;
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

    let native = c.asset == [0u8; 32];
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
        let before = spl_token_amount(escrow_ata)?;
        if transfer_fee > 0 {
            // Token-2022 fee path — destination receives amount − fee → ShortDelivery when fee>0.
            let mint_data = mint.try_borrow_data()?;
            if mint_data.len() < 45 {
                return Err(ProgramError::InvalidAccountData);
            }
            let decimals = mint_data[44];
            drop(mint_data);
            invoke(
                &spl_transfer_checked_with_fee(
                    token_program.key,
                    buyer_ata.key,
                    mint.key,
                    escrow_ata.key,
                    buyer.key,
                    amount,
                    decimals,
                    transfer_fee,
                ),
                &[
                    buyer_ata.clone(),
                    mint.clone(),
                    escrow_ata.clone(),
                    buyer.clone(),
                    token_program.clone(),
                ],
            )?;
        } else {
            invoke(
                &spl_transfer(token_program.key, buyer_ata.key, escrow_ata.key, buyer.key, amount),
                &[
                    buyer_ata.clone(),
                    escrow_ata.clone(),
                    buyer.clone(),
                    token_program.clone(),
                ],
            )?;
        }
        let after = spl_token_amount(escrow_ata)?;
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
    let mut a = load_asset(asset_info)?;
    release_custody(&mut a, buyer.key.to_bytes());
    let may = read_may_open(asset_info);
    save_asset(asset_info, &a)?;
    write_may_open(asset_info, may)?;

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
    let _ = (program_id, token_id);
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
    if credited.is_some() {
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

/// Token-2022 TransferCheckedWithFee (extension ix 26 / TransferFeeInstruction::TransferCheckedWithFee).
fn spl_transfer_checked_with_fee(
    token_program: &Pubkey,
    source: &Pubkey,
    mint: &Pubkey,
    dest: &Pubkey,
    authority: &Pubkey,
    amount: u64,
    decimals: u8,
    fee: u64,
) -> solana_program::instruction::Instruction {
    let mut data = vec![26u8, 1u8]; // TransferFeeExtension, TransferCheckedWithFee
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    data.extend_from_slice(&fee.to_le_bytes());
    solana_program::instruction::Instruction {
        program_id: *token_program,
        accounts: vec![
            solana_program::instruction::AccountMeta::new(*source, false),
            solana_program::instruction::AccountMeta::new_readonly(*mint, false),
            solana_program::instruction::AccountMeta::new(*dest, false),
            solana_program::instruction::AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

/// Accounts: authority(s) · config · payment_token · system · payer
fn approve_payment_token(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    mint: [u8; 32],
    decimals: u8,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let payment_token = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !authority.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if mint == [0u8; 32] {
        return Err(into_pe(KargainError::ZeroAddress));
    }
    let cfg = load_config(config)?;
    if cfg.authority != authority.key.to_bytes() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (key, bump) = payment_token_pda(program_id, &mint);
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
            &[PAYMENT_TOKEN_SEED, &mint, &[bump]],
        )?;
    }
    let rec = PaymentTokenRecord {
        discriminator: PAYMENT_TOKEN_DISC,
        mint,
        enabled: true,
        decimals,
        bump,
    };
    let mut data = payment_token.try_borrow_mut_data()?;
    rec.serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
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
    let asset_info = next_account_info(iter)?;
    let note_info = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    if !caller.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if buyer == [0u8; 32] {
        return Err(into_pe(KargainError::ZeroAddress));
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
    // Clear note
    let mut cleared = note;
    cleared.note_len = 0;
    cleared.note = [0u8; 256];
    {
        let mut data = note_info.try_borrow_mut_data()?;
        cleared
            .serialize(&mut &mut data[..])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
    }

    let mut a = load_asset(asset_info)?;
    release_custody(&mut a, buyer);
    let may = read_may_open(asset_info);
    save_asset(asset_info, &a)?;
    write_may_open(asset_info, may)?;

    clear_recall(recall_info)?;
    close_lot(&mut c, CloseReason::ExternalConfirmed);
    c.price = 0;
    c.floor = 0;
    save_consignment(consignment, &c)?;
    let _ = (program_id, token_id);
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
    withdraw_claim(&mut claim, |amount| {
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
    let mut data = claim_info.try_borrow_mut_data()?;
    claim
        .serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}
