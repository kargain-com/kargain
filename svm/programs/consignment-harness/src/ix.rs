//! Shared-automaton instructions for local-validator lifecycle proof.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_claimable_payouts::{
    claim_ata_pda, claim_pda, classify_spl_receive_reachability, pay_spl, verify_payout_recipient,
    ClaimAccount, CLAIM_ATA_SEED, CLAIM_SEED, ESCROW_SEED, SPL_TOKEN_ACCOUNT_LEN,
    PayoutAuthorities, PayoutLeg, SplReceiveReachability,
    emit::{emit_payout, PayoutEmitter},
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
    emit::{
        emit_commerce, event_closed, event_commission_lowered, event_floor_lowered,
        event_mandate_granted, event_opened, event_price_set, event_split_paid, CommerceEmitter,
        ConsignmentEvent,
    },
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

const COMMERCE_EMITTER: CommerceEmitter = CommerceEmitter::FixedPriceConsignment;

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum HarnessIx {
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
    /// Settle: move asset to buyer, then three-leg native or SPL payout, close Sold.
    /// Native path when asset_mint is zero. SPL path uses escrow ATA + claimable-payouts.
    SettleThreeLeg {
        token_id: [u8; 32],
        settled_amount: u64,
    },
    /// Harness: warp recall clock by writing requested_at in the past (test only).
    ForceRecallRequestedAt {
        token_id: [u8; 32],
        requested_at: u64,
    },
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
    let ix = HarnessIx::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        HarnessIx::InitConfig { platform_fee_bps } => init_config(program_id, accounts, platform_fee_bps),
        HarnessIx::CreateAsset { token_id } => create_asset(program_id, accounts, token_id),
        HarnessIx::ApproveEscrow { token_id } => approve_escrow(program_id, accounts, token_id),
        HarnessIx::SetMayOpen { token_id, allowed } => set_may_open(program_id, accounts, token_id, allowed),
        HarnessIx::SetSelfEncumbrance { registered } => set_self_enc(program_id, accounts, registered),
        HarnessIx::Grant {
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
        HarnessIx::Revoke { token_id } => revoke(program_id, accounts, token_id),
        HarnessIx::OpenDirect {
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
        HarnessIx::OpenFromMandate {
            token_id,
            denom_kind,
            currency_code,
            price,
        } => open_from_mandate(program_id, accounts, token_id, denom_kind, currency_code, price),
        HarnessIx::SetPrice { token_id, new_price } => set_price_ix(program_id, accounts, token_id, new_price),
        HarnessIx::LowerFloor { token_id, new_floor } => {
            lower_floor_ix(program_id, accounts, token_id, new_floor)
        }
        HarnessIx::LowerCommission { token_id, new_bps } => {
            lower_commission_ix(program_id, accounts, token_id, new_bps)
        }
        HarnessIx::RequestRecall { token_id } => request_recall_ix(program_id, accounts, token_id),
        HarnessIx::ForceRecall { token_id } => force_recall_ix(program_id, accounts, token_id),
        HarnessIx::OwnerWithdraw { token_id } => owner_withdraw_ix(program_id, accounts, token_id),
        HarnessIx::AgentWithdraw { token_id } => agent_withdraw_ix(program_id, accounts, token_id),
        HarnessIx::EnterCommitted { token_id } => enter_committed_ix(program_id, accounts, token_id),
        HarnessIx::Pause => pause_ix(program_id, accounts),
        HarnessIx::Unpause => unpause_ix(program_id, accounts),
        HarnessIx::SettleThreeLeg {
            token_id,
            settled_amount,
        } => settle_three_leg(program_id, accounts, token_id, settled_amount),
        HarnessIx::ForceRecallRequestedAt {
            token_id,
            requested_at,
        } => force_recall_at(program_id, accounts, token_id, requested_at),
    }
}

fn into_pe(e: KargainError) -> ProgramError {
    ProgramError::Custom(u32::from(e))
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
    let prior_agent = m.agent;
    // Zero active
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
    let _ = program_id;
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
    let denom = parse_denom(denom_kind, currency_code)?;
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
    emit_commerce(COMMERCE_EMITTER, &event_opened(&record));
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
    save_consignment(consignment, &record)?;
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

/// Accounts (native settle):
/// 0 caller · 1 config · 2 consignment · 3 asset · 4 buyer · 5 platform · 6 seller · 7 agent ·
/// 8 recall · 9 system · 10 payer
/// For SPL (asset_mint != 0): append escrow ATA, mint, token program, + per-leg recipient ATAs / claims
fn settle_three_leg(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    settled_amount: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let caller = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let consignment = next_account_info(iter)?;
    let asset_info = next_account_info(iter)?;
    let buyer = next_account_info(iter)?;
    let platform = next_account_info(iter)?;
    let seller_acc = next_account_info(iter)?;
    let agent_acc = next_account_info(iter)?;
    let recall_info = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    if !caller.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(config)?;
    let mut c = load_consignment(consignment)?;
    if !c.is_live() {
        return Err(into_pe(KargainError::NoLiveConsignment));
    }
    let split = compute_split_for_lot(settled_amount, &c).map_err(into_pe)?;
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

    // Custody to buyer BEFORE payment (mode duty).
    let mut a = load_asset(asset_info)?;
    release_custody(&mut a, buyer.key.to_bytes());
    let may = read_may_open(asset_info);
    save_asset(asset_info, &a)?;
    write_may_open(asset_info, may)?;

    let native = c.asset == [0u8; 32];
    if native {
        pay_native(payer, platform, split.platform, system)?;
        pay_native(payer, seller_acc, split.owner_amount, system)?;
        if split.agent_amount != 0 {
            pay_native(payer, agent_acc, split.agent_amount, system)?;
        }
    } else {
        // Remaining accounts: escrow_ata · escrow_auth · mint · token_program ·
        // platform_ata · seller_ata · agent_ata (optional) · claim PDAs as needed
        let escrow_ata = next_account_info(iter)?;
        let escrow_auth = next_account_info(iter)?;
        let mint = next_account_info(iter)?;
        let token_program = next_account_info(iter)?;
        if !escrow_auth.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }
        pay_spl_leg(
            program_id,
            payer,
            escrow_ata,
            escrow_auth,
            platform,
            next_account_info(iter)?,
            next_account_info(iter)?,
            next_account_info(iter)?,
            mint,
            token_program,
            system,
            split.platform,
        )?;
        pay_spl_leg(
            program_id,
            payer,
            escrow_ata,
            escrow_auth,
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
            pay_spl_leg(
                program_id,
                payer,
                escrow_ata,
                escrow_auth,
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
        let _ = ESCROW_SEED;
    }

    clear_recall(recall_info)?;
    close_lot(&mut c, CloseReason::Sold);
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
        &event_closed(token_id, CloseReason::Sold),
    );
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

fn pay_spl_leg<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    escrow_ata: &AccountInfo<'a>,
    escrow_auth: &AccountInfo<'a>,
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
            invoke(
                &spl_transfer(&escrow_key, dest.key, &auth_key, amount),
                &[
                    escrow_ata.clone(),
                    dest.clone(),
                    escrow_auth.clone(),
                    token_program.clone(),
                ],
            )
        },
        || {
            invoke(
                &spl_transfer(&escrow_key, &claim_ata_key, &auth_key, amount),
                &[
                    escrow_ata.clone(),
                    claim_ata.clone(),
                    escrow_auth.clone(),
                    token_program.clone(),
                ],
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
    source: &Pubkey,
    dest: &Pubkey,
    authority: &Pubkey,
    amount: u64,
) -> solana_program::instruction::Instruction {
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    solana_program::instruction::Instruction {
        program_id: token_program_id(),
        accounts: vec![
            solana_program::instruction::AccountMeta::new(*source, false),
            solana_program::instruction::AccountMeta::new(*dest, false),
            solana_program::instruction::AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}
