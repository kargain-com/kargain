//! PayLeg / WithdrawClaim for local-validator I5 proof.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_claimable_payouts::{
    claim_ata_pda, claim_pda, classify_spl_receive_reachability, pay_spl, spl_close_account_ix,
    withdraw_claim, ClaimAccount, CLAIM_ATA_SEED, CLAIM_SEED, SPL_TOKEN_ACCOUNT_LEN,
    SplReceiveReachability,
};
use kargain_errors::KargainError;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

/// Classic SPL Token program id (bytes).
fn token_program_id() -> Pubkey {
    Pubkey::new_from_array([
        6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133,
        237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
    ])
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum HarnessIx {
    /// Transfer `amount` from escrow ATA → recipient ATA if reachable, else claim.
    ///
    /// Accounts (11):
    /// 0 payer (signer) · 1 escrow ATA · 2 escrow authority (signer) ·
    /// 3 recipient wallet · 4 recipient token account (may be empty/system) ·
    /// 5 claim PDA · 6 claim ATA · 7 mint · 8 token program · 9 system · 10 rent
    PayLeg { amount: u64 },
    /// Withdraw claim tokens to a reachable recipient ATA.
    ///
    /// Accounts (6): recipient (signer) · claim PDA · claim ATA · dest ATA · mint · token program
    WithdrawClaim,
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let ix =
        HarnessIx::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        HarnessIx::PayLeg { amount } => pay_leg(program_id, accounts, amount),
        HarnessIx::WithdrawClaim => withdraw(program_id, accounts),
    }
}

fn into_pe(e: KargainError) -> ProgramError {
    ProgramError::Custom(u32::from(e))
}

fn pay_leg(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let iter = &mut accounts.iter();
    let payer = next_account_info(iter)?;
    let escrow_ata = next_account_info(iter)?;
    let escrow_authority = next_account_info(iter)?;
    let recipient_wallet = next_account_info(iter)?;
    let recipient_ata = next_account_info(iter)?;
    let claim_info = next_account_info(iter)?;
    let claim_ata = next_account_info(iter)?;
    let mint = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;
    let system_program = next_account_info(iter)?;
    let _rent_sysvar = next_account_info(iter)?;

    if !payer.is_signer || !escrow_authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let token_pid = token_program_id();
    if token_program.key != &token_pid {
        return Err(into_pe(KargainError::TokenNonConforming));
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
        ensure_claim_accounts(
            program_id,
            payer,
            claim_info,
            claim_ata,
            mint,
            token_program,
            system_program,
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
        let data = claim_info.try_borrow_data()?;
        ClaimAccount::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)?
    };

    let escrow_key = *escrow_ata.key;
    let claim_ata_key = *claim_ata.key;
    let auth_key = *escrow_authority.key;

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
                    escrow_authority.clone(),
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
                    escrow_authority.clone(),
                    token_program.clone(),
                ],
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

fn ensure_claim_accounts<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    claim_info: &AccountInfo<'a>,
    claim_ata: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>,
    recipient: &Pubkey,
    claim_bump: u8,
    ata_bump: u8,
) -> ProgramResult {
    let rent = Rent::get()?;
    if claim_info.data_is_empty() {
        let claim_lamports = rent.minimum_balance(ClaimAccount::SPACE);
        let seeds: &[&[u8]] = &[
            CLAIM_SEED,
            recipient.as_ref(),
            mint.key.as_ref(),
            &[claim_bump],
        ];
        invoke_signed(
            &system_instruction::create_account(
                payer.key,
                claim_info.key,
                claim_lamports,
                ClaimAccount::SPACE as u64,
                program_id,
            ),
            &[payer.clone(), claim_info.clone(), system_program.clone()],
            &[seeds],
        )?;
        let claim = ClaimAccount::new(recipient.to_bytes(), mint.key.to_bytes(), claim_bump);
        let mut data = claim_info.try_borrow_mut_data()?;
        claim
            .serialize(&mut &mut data[..])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
    }
    if claim_ata.data_is_empty() {
        let ata_lamports = rent.minimum_balance(SPL_TOKEN_ACCOUNT_LEN);
        let ata_seeds: &[&[u8]] = &[
            CLAIM_ATA_SEED,
            recipient.as_ref(),
            mint.key.as_ref(),
            &[ata_bump],
        ];
        invoke_signed(
            &system_instruction::create_account(
                payer.key,
                claim_ata.key,
                ata_lamports,
                SPL_TOKEN_ACCOUNT_LEN as u64,
                token_program.key,
            ),
            &[payer.clone(), claim_ata.clone(), system_program.clone()],
            &[ata_seeds],
        )?;
        invoke(
            &spl_initialize_account3(claim_ata.key, mint.key, claim_info.key),
            &[claim_ata.clone(), mint.clone(), token_program.clone()],
        )?;
    }
    Ok(())
}

fn withdraw(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
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
            &spl_transfer(&claim_ata_key, &dest_key, &claim_key_copy, amount),
            &[
                claim_ata.clone(),
                dest_ata.clone(),
                claim_info.clone(),
                token_program.clone(),
            ],
            &[seeds],
        )
    })?;

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

fn spl_initialize_account3(
    account: &Pubkey,
    mint: &Pubkey,
    owner: &Pubkey,
) -> solana_program::instruction::Instruction {
    let mut data = vec![18u8];
    data.extend_from_slice(owner.as_ref());
    solana_program::instruction::Instruction {
        program_id: token_program_id(),
        accounts: vec![
            solana_program::instruction::AccountMeta::new(*account, false),
            solana_program::instruction::AccountMeta::new_readonly(*mint, false),
        ],
        data,
    }
}
