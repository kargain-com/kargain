//! Encumbrance answer accounts — layout + sole PDA derivation + obligation lifecycle
//! (SPEC §13.7 / D-26 / D-44 / D-45).
//!
//! Seeds under the **source** program: `[seed_prefix, token_id, intent]` where
//! `intent` is a single byte (`LeaveChain = 0`, `OpenConsignment = 1`).
//! Passport and modes both call [`derive_encumbrance_answer_pda`] — never a
//! second copy. Account SPACE, signer seed lists, and create/close live here only.
//!
//! Accounts exist only while an obligation exists: [`open_obligation`] creates
//! both intents (`allowed = false`, recorded funder); [`close_obligation`]
//! refunds rent to that funder and reallocates to empty so passport `may`
//! reads `Uninitialised`.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_errors::KargainError;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

/// Max registered sources (matches EVM / passport `MAX_ENCUMBRANCE_SOURCES`).
pub const MAX_ENCUMBRANCE_SOURCES: usize = 8;

/// Solana PDA seed component ceiling.
pub const MAX_SEED_PREFIX_LEN: usize = 32;

/// Intent ordinals match `IKarPassportEncumbrance.Intent`.
pub const INTENT_LEAVE_CHAIN: u8 = 0;
pub const INTENT_OPEN_CONSIGNMENT: u8 = 1;

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct EncumbranceSourceEntry {
    pub program_id: [u8; 32],
    /// Registry-declared seed prefix; answer PDA derives under the source program.
    pub seed_prefix: Vec<u8>,
}

/// Answer record layout for encumbrance sources (SPEC §13.7).
///
/// Present only while an obligation exists. `allowed` is always `false` at
/// create; passport treats closed (empty) accounts as no obligation (allow).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct EncumbranceAnswer {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub intent: u8,
    /// `true` = allows; uninitialised account = no obligation.
    pub allowed: bool,
    /// Rent payer at [`open_obligation`]; sole reclaim recipient at close.
    pub funder: [u8; 32],
}

impl EncumbranceAnswer {
    /// Borsh size: disc(8) + token_id(32) + intent(1) + allowed(1) + funder(32).
    pub const SPACE: usize = 8 + 32 + 1 + 1 + 32;
}

pub const ENCUMBRANCE_ANSWER_DISCRIMINATOR: [u8; 8] = *b"enc_ans\0";

fn into_pe(e: KargainError) -> ProgramError {
    ProgramError::Custom(u32::from(e))
}

/// Refuse empty or oversized `seed_prefix` (Solana seed component rules).
pub fn require_valid_seed_prefix(seed_prefix: &[u8]) -> Result<(), KargainError> {
    if seed_prefix.is_empty() || seed_prefix.len() > MAX_SEED_PREFIX_LEN {
        return Err(KargainError::InvalidEncumbranceSeed);
    }
    Ok(())
}

/// Refuse intent outside LeaveChain / OpenConsignment.
pub fn require_valid_intent(intent: u8) -> Result<(), KargainError> {
    if intent != INTENT_LEAVE_CHAIN && intent != INTENT_OPEN_CONSIGNMENT {
        return Err(KargainError::InvalidEncumbranceIntent);
    }
    Ok(())
}

/// Sole seed recipe for derivation: `[seed_prefix, token_id, intent]`.
///
/// `intent_seed` must be `[intent]` kept alive by the caller.
#[inline]
pub fn encumbrance_answer_seeds<'a>(
    seed_prefix: &'a [u8],
    token_id: &'a [u8; 32],
    intent_seed: &'a [u8; 1],
) -> [&'a [u8]; 3] {
    [seed_prefix, token_id.as_ref(), intent_seed.as_ref()]
}

/// Signer seeds for create / invoke_signed: recipe + bump.
#[inline]
pub fn encumbrance_answer_signer_seeds<'a>(
    seed_prefix: &'a [u8],
    token_id: &'a [u8; 32],
    intent_seed: &'a [u8; 1],
    bump_seed: &'a [u8; 1],
) -> [&'a [u8]; 4] {
    [
        seed_prefix,
        token_id.as_ref(),
        intent_seed.as_ref(),
        bump_seed.as_ref(),
    ]
}

/// Sole answer-PDA derivation: `[seed_prefix, token_id, intent]` under `source_program`.
pub fn derive_encumbrance_answer_pda(
    source_program: &Pubkey,
    seed_prefix: &[u8],
    token_id: &[u8; 32],
    intent: u8,
) -> Result<(Pubkey, u8), KargainError> {
    require_valid_seed_prefix(seed_prefix)?;
    require_valid_intent(intent)?;
    let intent_seed = [intent];
    Ok(Pubkey::find_program_address(
        &encumbrance_answer_seeds(seed_prefix, token_id, &intent_seed),
        source_program,
    ))
}

fn require_answer_slot_free(answer_info: &AccountInfo) -> ProgramResult {
    if !answer_info.data_is_empty() || answer_info.lamports() != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    Ok(())
}

fn create_answer_pda<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    answer_info: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    seed_prefix: &[u8],
    token_id: &[u8; 32],
    intent: u8,
    funder: [u8; 32],
) -> ProgramResult {
    let (expected, bump) =
        derive_encumbrance_answer_pda(program_id, seed_prefix, token_id, intent).map_err(into_pe)?;
    if answer_info.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    require_answer_slot_free(answer_info)?;
    let intent_seed = [intent];
    let bump_seed = [bump];
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(EncumbranceAnswer::SPACE);
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            answer_info.key,
            lamports,
            EncumbranceAnswer::SPACE as u64,
            program_id,
        ),
        &[payer.clone(), answer_info.clone(), system.clone()],
        &[&encumbrance_answer_signer_seeds(
            seed_prefix,
            token_id,
            &intent_seed,
            &bump_seed,
        )],
    )?;
    let rec = EncumbranceAnswer {
        discriminator: ENCUMBRANCE_ANSWER_DISCRIMINATOR,
        token_id: *token_id,
        intent,
        allowed: false,
        funder,
    };
    let mut data = answer_info.try_borrow_mut_data()?;
    if data.len() < EncumbranceAnswer::SPACE {
        return Err(ProgramError::AccountDataTooSmall);
    }
    rec.serialize(&mut &mut data[..EncumbranceAnswer::SPACE])
        .map_err(|_| ProgramError::AccountDataTooSmall)?;
    Ok(())
}

/// Create both intent answer PDAs for a new obligation (`allowed = false`).
///
/// Refuses with [`ProgramError::AccountAlreadyInitialized`] if either slot is
/// already occupied (same native cause used for binding rebind). Payer is the
/// recorded rent funder.
pub fn open_obligation<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    leave_info: &AccountInfo<'a>,
    open_info: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    seed_prefix: &[u8],
    token_id: &[u8; 32],
) -> ProgramResult {
    require_valid_seed_prefix(seed_prefix).map_err(into_pe)?;
    // Fail closed before any create: either occupied slot refuses the whole open.
    require_answer_slot_free(leave_info)?;
    require_answer_slot_free(open_info)?;
    let funder = payer.key.to_bytes();
    create_answer_pda(
        program_id,
        payer,
        leave_info,
        system,
        seed_prefix,
        token_id,
        INTENT_LEAVE_CHAIN,
        funder,
    )?;
    create_answer_pda(
        program_id,
        payer,
        open_info,
        system,
        seed_prefix,
        token_id,
        INTENT_OPEN_CONSIGNMENT,
        funder,
    )?;
    Ok(())
}

fn verify_answer_for_close(
    program_id: &Pubkey,
    answer_info: &AccountInfo,
    seed_prefix: &[u8],
    token_id: &[u8; 32],
    intent: u8,
) -> Result<[u8; 32], ProgramError> {
    let (expected, _) =
        derive_encumbrance_answer_pda(program_id, seed_prefix, token_id, intent).map_err(into_pe)?;
    if answer_info.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if answer_info.data_is_empty() {
        return Err(ProgramError::UninitializedAccount);
    }
    if answer_info.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let data = answer_info.try_borrow_data()?;
    if data.len() < EncumbranceAnswer::SPACE {
        return Err(ProgramError::InvalidAccountData);
    }
    let rec = EncumbranceAnswer::try_from_slice(&data[..EncumbranceAnswer::SPACE])
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if rec.discriminator != ENCUMBRANCE_ANSWER_DISCRIMINATOR {
        return Err(ProgramError::InvalidAccountData);
    }
    if &rec.token_id != token_id || rec.intent != intent {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(rec.funder)
}

/// Drain → zero → realloc(0) → system. Realloc is required so passport `may`
/// sees empty data as Uninitialised (fill+assign alone leaves non-empty zeros
/// owned by system → Unanswerable).
pub fn close_answer_account_to_funder(
    answer_info: &AccountInfo,
    funder: &AccountInfo,
) -> ProgramResult {
    let lamports = answer_info.lamports();
    **answer_info.try_borrow_mut_lamports()? = 0;
    **funder.try_borrow_mut_lamports()? = funder
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    {
        let mut data = answer_info.try_borrow_mut_data()?;
        data.fill(0);
    }
    answer_info.resize(0)?;
    answer_info.assign(&system_program::ID);
    Ok(())
}

/// Close both intent PDAs and refund rent to the recorded funder.
///
/// Verifies both accounts before mutating either. Wrong reclaim recipient →
/// [`KargainError::WrongAnswerFunder`]. Missing either → `UninitializedAccount`.
pub fn close_obligation<'a>(
    program_id: &Pubkey,
    funder: &AccountInfo<'a>,
    leave_info: &AccountInfo<'a>,
    open_info: &AccountInfo<'a>,
    seed_prefix: &[u8],
    token_id: &[u8; 32],
) -> ProgramResult {
    require_valid_seed_prefix(seed_prefix).map_err(into_pe)?;
    let leave_funder = verify_answer_for_close(
        program_id,
        leave_info,
        seed_prefix,
        token_id,
        INTENT_LEAVE_CHAIN,
    )?;
    let open_funder = verify_answer_for_close(
        program_id,
        open_info,
        seed_prefix,
        token_id,
        INTENT_OPEN_CONSIGNMENT,
    )?;
    if leave_funder != open_funder {
        return Err(ProgramError::InvalidAccountData);
    }
    if funder.key.to_bytes() != leave_funder {
        return Err(into_pe(KargainError::WrongAnswerFunder));
    }
    if !funder.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    close_answer_account_to_funder(leave_info, funder)?;
    close_answer_account_to_funder(open_info, funder)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::account_info::MAX_PERMITTED_DATA_INCREASE;

    fn sample_answer(funder: [u8; 32]) -> EncumbranceAnswer {
        EncumbranceAnswer {
            discriminator: ENCUMBRANCE_ANSWER_DISCRIMINATOR,
            token_id: [1u8; 32],
            intent: INTENT_LEAVE_CHAIN,
            allowed: false,
            funder,
        }
    }

    /// Runtime layout for [`AccountInfo::resize`]: `original_data_len` lives in the
    /// 4 bytes immediately before `key`, and the serialized data length lives in
    /// the 8 bytes immediately before the data slice. Plain `AccountInfo::new`
    /// with a naked `Vec` lacks both — `resize` then writes out of bounds (UB;
    /// intermittent SIGSEGV when cargo runs this crate with `--test-threads` > 1).
    #[repr(C)]
    struct KeySlot {
        original_data_len: u32,
        key: Pubkey,
    }

    fn account_info_for_host_resize<'a>(
        key_slot: &'a mut KeySlot,
        // `[u64 le length][payload…][spare up to MAX_PERMITTED_DATA_INCREASE]`
        data_buf: &'a mut [u8],
        data_len: usize,
        lamports: &'a mut u64,
        owner: &'a Pubkey,
        is_writable: bool,
    ) -> AccountInfo<'a> {
        assert!(
            data_buf.len() >= 8 + data_len,
            "data_buf must hold length prefix + payload"
        );
        key_slot.original_data_len = u32::try_from(data_len).expect("data_len fits u32");
        data_buf[..8].copy_from_slice(&(data_len as u64).to_le_bytes());
        let data = &mut data_buf[8..8 + data_len];
        AccountInfo::new(
            &key_slot.key,
            false,
            is_writable,
            lamports,
            data,
            owner,
            false,
            0,
        )
    }

    #[test]
    fn empty_seed_prefix_refused() {
        assert_eq!(
            require_valid_seed_prefix(&[]),
            Err(KargainError::InvalidEncumbranceSeed)
        );
    }

    #[test]
    fn oversized_seed_prefix_refused() {
        assert_eq!(
            require_valid_seed_prefix(&[0u8; 33]),
            Err(KargainError::InvalidEncumbranceSeed)
        );
    }

    #[test]
    fn invalid_intent_refused() {
        assert_eq!(
            require_valid_intent(2),
            Err(KargainError::InvalidEncumbranceIntent)
        );
    }

    #[test]
    fn answer_space_matches_borsh() {
        let rec = sample_answer([9u8; 32]);
        let mut buf = Vec::new();
        rec.serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), EncumbranceAnswer::SPACE);
        assert_eq!(EncumbranceAnswer::SPACE, 74);
        let round = EncumbranceAnswer::try_from_slice(&buf).unwrap();
        assert_eq!(round.funder, [9u8; 32]);
        assert!(!round.allowed);
    }

    #[test]
    fn legacy_42_byte_blob_does_not_decode() {
        // Pre-6c layout: disc + token + intent + allowed = 42 — must fail exact slice.
        let legacy = [
            ENCUMBRANCE_ANSWER_DISCRIMINATOR.as_slice(),
            &[1u8; 32][..],
            &[INTENT_LEAVE_CHAIN],
            &[0u8],
        ]
        .concat();
        assert_eq!(legacy.len(), 42);
        assert!(EncumbranceAnswer::try_from_slice(&legacy).is_err());
    }

    #[test]
    fn derive_deterministic_for_ans_prefix() {
        let program = Pubkey::new_from_array([0x11u8; 32]);
        let token = [0x22u8; 32];
        let (a, bump_a) =
            derive_encumbrance_answer_pda(&program, b"ans", &token, INTENT_LEAVE_CHAIN).unwrap();
        let (b, bump_b) =
            derive_encumbrance_answer_pda(&program, b"ans", &token, INTENT_LEAVE_CHAIN).unwrap();
        assert_eq!(a, b);
        assert_eq!(bump_a, bump_b);
        let (c, _) =
            derive_encumbrance_answer_pda(&program, b"ans", &token, INTENT_OPEN_CONSIGNMENT)
                .unwrap();
        assert_ne!(a, c, "intent byte must separate LeaveChain from OpenConsignment");
    }

    #[test]
    fn derive_empty_prefix_errors() {
        let program = Pubkey::new_from_array([0x11u8; 32]);
        assert_eq!(
            derive_encumbrance_answer_pda(&program, &[], &[0u8; 32], 0),
            Err(KargainError::InvalidEncumbranceSeed)
        );
    }

    #[test]
    fn signer_seeds_match_derivation_recipe() {
        let program = Pubkey::new_from_array([0x33u8; 32]);
        let seed_prefix = b"fp";
        let token = [0x44u8; 32];
        let intent = INTENT_OPEN_CONSIGNMENT;
        let (expected, bump) =
            derive_encumbrance_answer_pda(&program, seed_prefix, &token, intent).unwrap();
        let intent_seed = [intent];
        let bump_seed = [bump];
        let from_signer = Pubkey::create_program_address(
            &encumbrance_answer_signer_seeds(seed_prefix, &token, &intent_seed, &bump_seed),
            &program,
        )
        .unwrap();
        assert_eq!(expected, from_signer);
    }

    #[test]
    fn diverged_signer_recipe_is_red() {
        let program = Pubkey::new_from_array([0x55u8; 32]);
        let seed_prefix = b"fp";
        let token = [0x66u8; 32];
        let intent = INTENT_LEAVE_CHAIN;
        let (expected, bump) =
            derive_encumbrance_answer_pda(&program, seed_prefix, &token, intent).unwrap();
        let intent_seed = [intent];
        let bump_seed = [bump];
        let diverged: [&[u8]; 4] = [
            token.as_ref(),
            seed_prefix,
            intent_seed.as_ref(),
            bump_seed.as_ref(),
        ];
        let from_diverged = Pubkey::create_program_address(&diverged, &program);
        match from_diverged {
            Ok(pk) => assert_ne!(pk, expected, "diverged recipe must not equal derive PDA"),
            Err(_) => {}
        }
        let live = Pubkey::create_program_address(
            &encumbrance_answer_signer_seeds(seed_prefix, &token, &intent_seed, &bump_seed),
            &program,
        )
        .unwrap();
        assert_eq!(live, expected);
    }

    #[test]
    fn wrong_answer_funder_ordinal_is_142() {
        assert_eq!(u32::from(KargainError::WrongAnswerFunder), 142);
        assert_eq!(KargainError::WrongAnswerFunder.name(), "WrongAnswerFunder");
    }

    #[test]
    fn occupied_slot_refuses_as_already_initialized() {
        let key = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let mut lamports = 1u64;
        let mut data = vec![0u8; EncumbranceAnswer::SPACE];
        let info = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
            0,
        );
        assert_eq!(
            require_answer_slot_free(&info),
            Err(ProgramError::AccountAlreadyInitialized)
        );
    }

    #[test]
    fn free_slot_accepts_empty_system() {
        let key = Pubkey::new_unique();
        let owner = system_program::ID;
        let mut lamports = 0u64;
        let mut data = vec![];
        let info = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
            0,
        );
        assert!(require_answer_slot_free(&info).is_ok());
    }

    /// Plant: fill+assign without realloc leaves non-empty zeros under system —
    /// the passport classifier treats that as Unanswerable, not Uninitialised.
    #[test]
    fn fill_assign_without_realloc_is_not_empty() {
        let key = Pubkey::new_unique();
        let owner = Pubkey::new_from_array([0xAAu8; 32]);
        let mut lamports = 1_000_000u64;
        let mut data = vec![0xFFu8; EncumbranceAnswer::SPACE];
        let info = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
            0,
        );
        {
            let mut d = info.try_borrow_mut_data().unwrap();
            d.fill(0);
        }
        // Simulate close_pda without realloc:
        **info.try_borrow_mut_lamports().unwrap() = 0;
        info.assign(&system_program::ID);
        assert!(
            !info.data_is_empty(),
            "fill+assign leaves length — Unanswerable to may"
        );
        assert_eq!(info.data_len(), EncumbranceAnswer::SPACE);
    }

    /// Control: `AccountInfo::resize` on a runtime-shaped buffer is defined and
    /// survives shrink-to-zero. The same call on a naked `AccountInfo::new` Vec
    /// is the measured SIGSEGV under parallel `cargo test` (writes `data_ptr-8`).
    #[test]
    fn host_resize_fixture_survives_shrink_to_zero() {
        let mut key_slot = KeySlot {
            original_data_len: 0,
            key: Pubkey::new_unique(),
        };
        let owner = Pubkey::new_from_array([0xBBu8; 32]);
        let mut lamports = 1u64;
        let space = EncumbranceAnswer::SPACE;
        let mut data_buf = vec![0u8; 8 + space + MAX_PERMITTED_DATA_INCREASE];
        data_buf[8..8 + space].fill(0xAB);
        let info = account_info_for_host_resize(
            &mut key_slot,
            &mut data_buf,
            space,
            &mut lamports,
            &owner,
            true,
        );
        assert_eq!(info.data_len(), space);
        info.resize(0).unwrap();
        assert!(info.data_is_empty());
        assert_eq!(u64::from_le_bytes(data_buf[..8].try_into().unwrap()), 0);
    }

    #[test]
    fn close_answer_resize_zero_is_empty() {
        let program = Pubkey::new_from_array([0xBBu8; 32]);
        let funder_key = Pubkey::new_unique();
        let owner = program;
        let funder_owner = system_program::ID;
        let mut answer_lamports = 2_000_000u64;
        let mut funder_lamports = 5_000_000u64;
        let space = EncumbranceAnswer::SPACE;
        let mut key_slot = KeySlot {
            original_data_len: 0,
            key: Pubkey::new_unique(),
        };
        let mut data_buf = vec![0u8; 8 + space + MAX_PERMITTED_DATA_INCREASE];
        {
            let rec = sample_answer(funder_key.to_bytes());
            rec.serialize(&mut &mut data_buf[8..8 + space]).unwrap();
        }
        let mut funder_data = vec![];
        let answer = account_info_for_host_resize(
            &mut key_slot,
            &mut data_buf,
            space,
            &mut answer_lamports,
            &owner,
            true,
        );
        let funder = AccountInfo::new(
            &funder_key,
            false,
            true,
            &mut funder_lamports,
            &mut funder_data,
            &funder_owner,
            false,
            0,
        );
        let before = funder.lamports();
        let refund = answer.lamports();
        close_answer_account_to_funder(&answer, &funder).unwrap();
        assert_eq!(funder.lamports(), before + refund);
        assert_eq!(answer.lamports(), 0);
        assert!(answer.data_is_empty());
        assert_eq!(*answer.owner, system_program::ID);
    }

    #[test]
    fn verify_close_wrong_funder_path() {
        let program = Pubkey::new_from_array([0xCCu8; 32]);
        let seed = b"fp";
        let token = [0x77u8; 32];
        let (leave_pk, _) =
            derive_encumbrance_answer_pda(&program, seed, &token, INTENT_LEAVE_CHAIN).unwrap();
        let recorded = Pubkey::new_from_array([0x11u8; 32]);
        let wrong = Pubkey::new_from_array([0x22u8; 32]);
        let owner = program;
        let mut lamports = 1u64;
        let mut data = {
            let rec = EncumbranceAnswer {
                discriminator: ENCUMBRANCE_ANSWER_DISCRIMINATOR,
                token_id: token,
                intent: INTENT_LEAVE_CHAIN,
                allowed: false,
                funder: recorded.to_bytes(),
            };
            let mut buf = vec![0u8; EncumbranceAnswer::SPACE];
            rec.serialize(&mut &mut buf[..]).unwrap();
            buf
        };
        let leave = AccountInfo::new(
            &leave_pk,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
            0,
        );
        let got = verify_answer_for_close(
            &program,
            &leave,
            seed,
            &token,
            INTENT_LEAVE_CHAIN,
        )
        .unwrap();
        assert_eq!(got, recorded.to_bytes());
        assert_ne!(got, wrong.to_bytes());
    }
}
