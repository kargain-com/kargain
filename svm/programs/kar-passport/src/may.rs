//! `may(tokenId, intent)` — exists → challenge → source answer PDAs (SPEC §13.7 / D-14).
//! Does **not** consult `custody_locked` or Core freeze.

use kargain_bonded_challenge::{ChallengeAccount, CHALLENGE_SEED};
use kargain_encumbrance::{
    derive_encumbrance_answer_pda, require_valid_intent, EncumbranceAnswer,
    EncumbranceSourceEntry, ENCUMBRANCE_ANSWER_DISCRIMINATOR,
};
use kargain_errors::KargainError;
use borsh::BorshDeserialize;
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::core_asset::is_live_core_asset;
use crate::seeds::{asset_pda, config_pda};
use crate::state::{PassportConfig, PASSPORT_CONFIG_DISCRIMINATOR};

/// Host-visible fact about one registered source's answer account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceAnswerView {
    /// Account missing / zero data — uninitialised = no obligation.
    Uninitialised,
    /// Readable answer for this token + intent.
    Answer { allowed: bool },
    /// Wrong owner program, discriminator, or length → named refuse.
    Unanswerable,
}

/// Pure `may` check order. Callers supply asset existence and challenge/source facts.
pub fn may_leave_or_open(
    asset_exists: bool,
    challenge_active: bool,
    sources: &[EncumbranceSourceEntry],
    answers: &[SourceAnswerView],
) -> Result<bool, KargainError> {
    if !asset_exists {
        return Err(KargainError::NonexistentToken);
    }
    // E5 — intrinsic verification challenge forbids both intents.
    if challenge_active {
        return Ok(false);
    }
    if sources.len() != answers.len() {
        // Programming error at the call site — treat as unanswerable first source.
        if let Some(first) = sources.first() {
            let _ = first;
            return Err(KargainError::SourceUnanswerable);
        }
        return Ok(true);
    }
    for answer in answers {
        match answer {
            SourceAnswerView::Uninitialised => {}
            SourceAnswerView::Answer { allowed: true } => {}
            SourceAnswerView::Answer { allowed: false } => return Ok(false),
            SourceAnswerView::Unanswerable => return Err(KargainError::SourceUnanswerable),
        }
    }
    Ok(true)
}

/// Parse an answer account blob. Wrong discriminator / short data = unanswerable.
pub fn classify_answer_data(
    data: Option<&[u8]>,
    expected_token_id: &[u8; 32],
    expected_intent: u8,
    owned_by_source_program: bool,
) -> SourceAnswerView {
    let Some(data) = data else {
        return SourceAnswerView::Uninitialised;
    };
    if data.is_empty() {
        return SourceAnswerView::Uninitialised;
    }
    if !owned_by_source_program {
        return SourceAnswerView::Unanswerable;
    }
    let parsed = match EncumbranceAnswer::try_from_slice(data) {
        Ok(a) => a,
        Err(_) => return SourceAnswerView::Unanswerable,
    };
    if parsed.discriminator != ENCUMBRANCE_ANSWER_DISCRIMINATOR {
        return SourceAnswerView::Unanswerable;
    }
    if &parsed.token_id != expected_token_id || parsed.intent != expected_intent {
        return SourceAnswerView::Unanswerable;
    }
    SourceAnswerView::Answer {
        allowed: parsed.allowed,
    }
}

/// Challenge activity = `ChallengeAccount.opened_at != 0` only (never PassportState.status).
pub fn challenge_active_from_account(
    program_id: &Pubkey,
    challenge: &AccountInfo,
    token_id: &[u8; 32],
) -> Result<bool, ProgramError> {
    let (expected, _) = Pubkey::find_program_address(&[CHALLENGE_SEED, token_id], program_id);
    if challenge.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if challenge.data_is_empty() {
        return Ok(false);
    }
    if challenge.owner != program_id {
        return Err(into_pe(KargainError::SourceUnanswerable));
    }
    let data = challenge.try_borrow_data()?;
    let account = ChallengeAccount::try_from_slice(&data)
        .map_err(|_| into_pe(KargainError::SourceUnanswerable))?;
    Ok(account.is_active())
}

fn into_pe(e: KargainError) -> ProgramError {
    ProgramError::Custom(e as u32)
}

/// Classify one answer account against a registry entry (owner + PDA + payload).
pub fn classify_answer_account(
    answer: &AccountInfo,
    source: &EncumbranceSourceEntry,
    token_id: &[u8; 32],
    intent: u8,
) -> Result<SourceAnswerView, KargainError> {
    let source_program = Pubkey::new_from_array(source.program_id);
    let (expected, _) =
        derive_encumbrance_answer_pda(&source_program, &source.seed_prefix, token_id, intent)?;
    if answer.key != &expected {
        return Err(KargainError::SourceUnanswerable);
    }
    let owned = answer.owner == &source_program;
    let data = answer
        .try_borrow_data()
        .map_err(|_| KargainError::SourceUnanswerable)?;
    Ok(classify_answer_data(
        if data.is_empty() {
            None
        } else {
            Some(&data[..])
        },
        token_id,
        intent,
        owned,
    ))
}

/// Sole may evaluator from account metas.
///
/// Layout: config · asset · challenge · answer[0..N] where N = registry.len().
pub fn resolve_may_accounts(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    intent: u8,
) -> Result<bool, ProgramError> {
    require_valid_intent(intent).map_err(into_pe)?;
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let config_ai = &accounts[0];
    let asset = &accounts[1];
    let challenge = &accounts[2];
    let answer_tail = &accounts[3..];

    let (cfg_key, _) = config_pda(program_id);
    if config_ai.key != &cfg_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if config_ai.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let cfg = PassportConfig::try_from_slice(&config_ai.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if cfg.discriminator != PASSPORT_CONFIG_DISCRIMINATOR {
        return Err(ProgramError::InvalidAccountData);
    }

    // Bind asset to this token before any existence predicate (sibling of MintPassport).
    let (expected_asset, _) = asset_pda(program_id, &token_id);
    if asset.key != &expected_asset {
        return Err(ProgramError::InvalidSeeds);
    }

    let n = cfg.encumbrance_sources.len();
    if answer_tail.len() != n {
        return Err(into_pe(KargainError::SourceUnanswerable));
    }

    let challenge_active = challenge_active_from_account(program_id, challenge, &token_id)?;
    let mut answers = Vec::with_capacity(n);
    for (i, source) in cfg.encumbrance_sources.iter().enumerate() {
        let view = classify_answer_account(&answer_tail[i], source, &token_id, intent)
            .map_err(into_pe)?;
        answers.push(view);
    }

    may_leave_or_open(
        is_live_core_asset(asset),
        challenge_active,
        &cfg.encumbrance_sources,
        &answers,
    )
    .map_err(into_pe)
}

/// Entrypoint helper — runs resolve and maps false → LeaveChainRefused / OpenConsignmentRefused.
pub fn process_may(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    intent: u8,
) -> ProgramResult {
    let allowed = resolve_may_accounts(program_id, accounts, token_id, intent)?;
    if allowed {
        Ok(())
    } else if intent == kargain_encumbrance::INTENT_LEAVE_CHAIN {
        Err(into_pe(KargainError::LeaveChainRefused))
    } else {
        Err(into_pe(KargainError::OpenConsignmentRefused))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kargain_encumbrance::EncumbranceSourceEntry;

    fn src() -> EncumbranceSourceEntry {
        EncumbranceSourceEntry {
            program_id: [1u8; 32],
            seed_prefix: b"ans".to_vec(),
        }
    }

    #[test]
    fn nonexistent_asset_errors() {
        assert_eq!(
            may_leave_or_open(false, false, &[], &[]),
            Err(KargainError::NonexistentToken)
        );
    }

    #[test]
    fn active_challenge_refuses_without_error() {
        assert_eq!(may_leave_or_open(true, true, &[], &[]), Ok(false));
    }

    #[test]
    fn no_sources_allows() {
        assert_eq!(may_leave_or_open(true, false, &[], &[]), Ok(true));
    }

    #[test]
    fn uninitialised_source_is_no_obligation() {
        let sources = [src()];
        let answers = [SourceAnswerView::Uninitialised];
        assert_eq!(may_leave_or_open(true, false, &sources, &answers), Ok(true));
    }

    #[test]
    fn explicit_false_refuses() {
        let sources = [src()];
        let answers = [SourceAnswerView::Answer { allowed: false }];
        assert_eq!(may_leave_or_open(true, false, &sources, &answers), Ok(false));
    }

    #[test]
    fn unanswerable_named_error() {
        let sources = [src()];
        let answers = [SourceAnswerView::Unanswerable];
        assert_eq!(
            may_leave_or_open(true, false, &sources, &answers),
            Err(KargainError::SourceUnanswerable)
        );
    }

    #[test]
    fn order_is_exists_then_challenge_before_sources() {
        let sources = [src()];
        let answers = [SourceAnswerView::Answer { allowed: true }];
        assert_eq!(
            may_leave_or_open(false, true, &sources, &answers),
            Err(KargainError::NonexistentToken)
        );
    }

    #[test]
    fn classify_empty_uninitialised() {
        assert_eq!(
            classify_answer_data(None, &[0u8; 32], 0, true),
            SourceAnswerView::Uninitialised
        );
        assert_eq!(
            classify_answer_data(Some(&[]), &[0u8; 32], 0, true),
            SourceAnswerView::Uninitialised
        );
    }

    #[test]
    fn classify_wrong_owner_unanswerable() {
        assert_eq!(
            classify_answer_data(Some(&[1, 2, 3]), &[0u8; 32], 0, false),
            SourceAnswerView::Unanswerable
        );
    }

    #[test]
    fn allowed_answer_passes() {
        let sources = [src()];
        let answers = [SourceAnswerView::Answer { allowed: true }];
        assert_eq!(may_leave_or_open(true, false, &sources, &answers), Ok(true));
    }

    #[test]
    fn tail_shorter_than_registry_is_unanswerable() {
        let sources = [src()];
        assert_eq!(
            may_leave_or_open(true, false, &sources, &[]),
            Err(KargainError::SourceUnanswerable)
        );
    }

    #[test]
    fn add_remove_ix_append_after_transfer() {
        use crate::instruction::PassportIx;
        let transfer = PassportIx::TransferPassport {
            token_id: [0u8; 32],
        };
        let add = PassportIx::AddEncumbranceSource {
            program_id: [1u8; 32],
            seed_prefix: b"ans".to_vec(),
        };
        let remove = PassportIx::RemoveEncumbranceSource {
            program_id: [1u8; 32],
        };
        let t = borsh::to_vec(&transfer).unwrap();
        let a = borsh::to_vec(&add).unwrap();
        let r = borsh::to_vec(&remove).unwrap();
        assert_eq!(t[0], 20, "TransferPassport discriminant");
        assert_eq!(a[0], 21, "AddEncumbranceSource must append as 21");
        assert_eq!(r[0], 22, "RemoveEncumbranceSource must append as 22");
    }

    #[test]
    fn config_encode_grows_and_shrinks_exact_for_try_from_slice() {
        use crate::state::{PassportConfig, PASSPORT_CONFIG_DISCRIMINATOR};
        use borsh::BorshDeserialize;
        use solana_program::rent::Rent;
        let mut cfg = PassportConfig {
            discriminator: PASSPORT_CONFIG_DISCRIMINATOR,
            authority: [9u8; 32],
            namespace: 1,
            local_eid: 1,
            endpoint_program: [0u8; 32],
            dispute_deposit: 0,
            staking_program: [0u8; 32],
            bridge_gateway: [0u8; 32],
            forfeit_recipient: [0u8; 32],
            next_token_id: [0u8; 32],
            encumbrance_sources: vec![],
            bump: 1,
        };
        let empty = borsh::to_vec(&cfg).unwrap();
        cfg.encumbrance_sources.push(src());
        let with_one = borsh::to_vec(&cfg).unwrap();
        assert!(with_one.len() > empty.len(), "add must grow Borsh payload");
        // Exact-length deserialize succeeds; trailing capacity would brick.
        assert!(PassportConfig::try_from_slice(&with_one).is_ok());
        let mut padded = with_one.clone();
        padded.push(0);
        assert!(
            PassportConfig::try_from_slice(&padded).is_err(),
            "trailing bytes after shrink must not be left in the account"
        );
        cfg.encumbrance_sources.pop();
        let shrunk = borsh::to_vec(&cfg).unwrap();
        assert_eq!(shrunk.len(), empty.len());
        assert!(PassportConfig::try_from_slice(&shrunk).is_ok());

        // Reportable growth facts (realloc target = encoded.len(); payer funds rent delta).
        let rent = Rent::default();
        let before_rent = rent.minimum_balance(empty.len());
        let after_rent = rent.minimum_balance(with_one.len());
        let growth = with_one.len() - empty.len();
        let rent_delta = after_rent - before_rent;
        assert!(growth > 0);
        assert!(rent_delta > 0);
        // Measured on this layout (empty registry → one EncumbranceSourceEntry{program_id,seed_prefix=b"ans"}):
        assert_eq!(empty.len(), 233);
        assert_eq!(with_one.len(), 272);
        assert_eq!(growth, 39);
        assert_eq!(rent_delta, 271_440, "Rent::default() delta for 233→272 B");
    }

    #[test]
    fn swap_remove_source_by_program_id() {
        let a = EncumbranceSourceEntry {
            program_id: [1u8; 32],
            seed_prefix: b"a".to_vec(),
        };
        let b = EncumbranceSourceEntry {
            program_id: [2u8; 32],
            seed_prefix: b"b".to_vec(),
        };
        let c = EncumbranceSourceEntry {
            program_id: [3u8; 32],
            seed_prefix: b"c".to_vec(),
        };
        let mut sources = vec![a.clone(), b.clone(), c.clone()];
        let idx = sources.iter().position(|e| e.program_id == [1u8; 32]).unwrap();
        let last = sources.len() - 1;
        sources.swap(idx, last);
        sources.pop();
        assert_eq!(sources.len(), 2);
        assert!(sources.iter().any(|e| e.program_id == [2u8; 32]));
        assert!(sources.iter().any(|e| e.program_id == [3u8; 32]));
        assert!(!sources.iter().any(|e| e.program_id == [1u8; 32]));
    }

    /// Fixture helper for empty-registry `resolve_may_accounts` metas.
    fn empty_config_bytes(bump: u8) -> Vec<u8> {
        let cfg = PassportConfig {
            discriminator: PASSPORT_CONFIG_DISCRIMINATOR,
            authority: [9u8; 32],
            namespace: 1,
            local_eid: 1,
            endpoint_program: [0u8; 32],
            dispute_deposit: 0,
            staking_program: [0u8; 32],
            bridge_gateway: [0u8; 32],
            forfeit_recipient: [0u8; 32],
            next_token_id: [0u8; 32],
            encumbrance_sources: vec![],
            bump,
        };
        borsh::to_vec(&cfg).unwrap()
    }

    #[test]
    fn resolve_wrong_live_core_asset_is_invalid_seeds() {
        use crate::seeds::asset_pda;
        use solana_program::system_program;

        let program_id = Pubkey::new_from_array([0xAAu8; 32]);
        let token_id = [0x11u8; 32];
        let other_token = [0x22u8; 32];
        let (cfg_key, bump) = config_pda(&program_id);
        let (wrong_asset_key, _) = asset_pda(&program_id, &other_token);
        let (challenge_key, _) =
            Pubkey::find_program_address(&[CHALLENGE_SEED, &token_id], &program_id);

        let mut cfg_data = empty_config_bytes(bump);
        let mut cfg_lamports = 1u64;
        let mut asset_data = vec![0u8; 8]; // live Core shape
        let mut asset_lamports = 1u64;
        let mut challenge_data: Vec<u8> = vec![];
        let mut challenge_lamports = 0u64;
        let core = mpl_core::ID;
        let system = system_program::ID;

        let config_ai = AccountInfo::new(
            &cfg_key,
            false,
            false,
            &mut cfg_lamports,
            &mut cfg_data[..],
            &program_id,
            false,
            0,
        );
        let asset_ai = AccountInfo::new(
            &wrong_asset_key,
            false,
            false,
            &mut asset_lamports,
            &mut asset_data[..],
            &core,
            false,
            0,
        );
        let challenge_ai = AccountInfo::new(
            &challenge_key,
            false,
            false,
            &mut challenge_lamports,
            &mut challenge_data[..],
            &system,
            false,
            0,
        );
        let accounts = [config_ai, asset_ai, challenge_ai];
        let err = resolve_may_accounts(&program_id, &accounts, token_id, 0).unwrap_err();
        assert_eq!(
            err,
            ProgramError::InvalidSeeds,
            "wrong-token live Core in asset slot must refuse before existence"
        );
    }

    #[test]
    fn resolve_system_owned_wrong_key_is_invalid_seeds() {
        use solana_program::system_program;

        let program_id = Pubkey::new_from_array([0xBBu8; 32]);
        let token_id = [0x33u8; 32];
        let (cfg_key, bump) = config_pda(&program_id);
        let (challenge_key, _) =
            Pubkey::find_program_address(&[CHALLENGE_SEED, &token_id], &program_id);
        let foreign_key = Pubkey::new_from_array([0xFFu8; 32]);

        let mut cfg_data = empty_config_bytes(bump);
        let mut cfg_lamports = 1u64;
        let mut asset_data: Vec<u8> = vec![];
        let mut asset_lamports = 0u64;
        let mut challenge_data: Vec<u8> = vec![];
        let mut challenge_lamports = 0u64;
        let system = system_program::ID;

        let config_ai = AccountInfo::new(
            &cfg_key,
            false,
            false,
            &mut cfg_lamports,
            &mut cfg_data[..],
            &program_id,
            false,
            0,
        );
        let asset_ai = AccountInfo::new(
            &foreign_key,
            false,
            false,
            &mut asset_lamports,
            &mut asset_data[..],
            &system,
            false,
            0,
        );
        let challenge_ai = AccountInfo::new(
            &challenge_key,
            false,
            false,
            &mut challenge_lamports,
            &mut challenge_data[..],
            &system,
            false,
            0,
        );
        let accounts = [config_ai, asset_ai, challenge_ai];
        let err = resolve_may_accounts(&program_id, &accounts, token_id, 0).unwrap_err();
        assert_eq!(err, ProgramError::InvalidSeeds);
    }

    #[test]
    fn resolve_correct_pda_tombstone_is_nonexistent_token() {
        use crate::seeds::asset_pda;
        use solana_program::system_program;

        let program_id = Pubkey::new_from_array([0xCCu8; 32]);
        let token_id = [0x44u8; 32];
        let (cfg_key, bump) = config_pda(&program_id);
        let (asset_key, _) = asset_pda(&program_id, &token_id);
        let (challenge_key, _) =
            Pubkey::find_program_address(&[CHALLENGE_SEED, &token_id], &program_id);

        let mut cfg_data = empty_config_bytes(bump);
        let mut cfg_lamports = 1u64;
        let mut asset_data = vec![0u8; 1]; // Core 1-byte tombstone (D-17)
        let mut asset_lamports = 1u64;
        let mut challenge_data: Vec<u8> = vec![];
        let mut challenge_lamports = 0u64;
        let core = mpl_core::ID;
        let system = system_program::ID;

        let config_ai = AccountInfo::new(
            &cfg_key,
            false,
            false,
            &mut cfg_lamports,
            &mut cfg_data[..],
            &program_id,
            false,
            0,
        );
        let asset_ai = AccountInfo::new(
            &asset_key,
            false,
            false,
            &mut asset_lamports,
            &mut asset_data[..],
            &core,
            false,
            0,
        );
        let challenge_ai = AccountInfo::new(
            &challenge_key,
            false,
            false,
            &mut challenge_lamports,
            &mut challenge_data[..],
            &system,
            false,
            0,
        );
        let accounts = [config_ai, asset_ai, challenge_ai];
        let err = resolve_may_accounts(&program_id, &accounts, token_id, 0).unwrap_err();
        assert_eq!(
            err,
            ProgramError::Custom(KargainError::NonexistentToken as u32),
            "correct PDA that is not a live Core asset → NonexistentToken"
        );
    }

    #[test]
    fn resolve_correct_live_asset_empty_registry_allows() {
        use crate::seeds::asset_pda;
        use solana_program::system_program;

        let program_id = Pubkey::new_from_array([0xDDu8; 32]);
        let token_id = [0x55u8; 32];
        let (cfg_key, bump) = config_pda(&program_id);
        let (asset_key, _) = asset_pda(&program_id, &token_id);
        let (challenge_key, _) =
            Pubkey::find_program_address(&[CHALLENGE_SEED, &token_id], &program_id);

        let mut cfg_data = empty_config_bytes(bump);
        let mut cfg_lamports = 1u64;
        let mut asset_data = vec![0u8; 8];
        let mut asset_lamports = 1u64;
        let mut challenge_data: Vec<u8> = vec![];
        let mut challenge_lamports = 0u64;
        let core = mpl_core::ID;
        let system = system_program::ID;

        let config_ai = AccountInfo::new(
            &cfg_key,
            false,
            false,
            &mut cfg_lamports,
            &mut cfg_data[..],
            &program_id,
            false,
            0,
        );
        let asset_ai = AccountInfo::new(
            &asset_key,
            false,
            false,
            &mut asset_lamports,
            &mut asset_data[..],
            &core,
            false,
            0,
        );
        let challenge_ai = AccountInfo::new(
            &challenge_key,
            false,
            false,
            &mut challenge_lamports,
            &mut challenge_data[..],
            &system,
            false,
            0,
        );
        let accounts = [config_ai, asset_ai, challenge_ai];
        assert_eq!(accounts.len(), 3, "empty registry ⇒ 3 metas");
        assert_eq!(
            resolve_may_accounts(&program_id, &accounts, token_id, 0).unwrap(),
            true
        );
    }
}
