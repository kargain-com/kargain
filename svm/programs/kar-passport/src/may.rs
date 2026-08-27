//! `may(tokenId, intent)` — exists → challenge → source answer PDAs (SPEC §13.7 / D-14).
//! Does **not** consult `custody_locked`.

use kargain_errors::KargainError;

use crate::state::{EncumbranceAnswer, EncumbranceSourceEntry, ENCUMBRANCE_ANSWER_DISCRIMINATOR};

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
    let parsed = match EncumbranceAnswer::try_from_slice_compat(data) {
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

impl EncumbranceAnswer {
    fn try_from_slice_compat(data: &[u8]) -> Result<Self, ()> {
        borsh::BorshDeserialize::try_from_slice(data).map_err(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::EncumbranceSourceEntry;

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
        // Challenge would refuse, but nonexistent wins first.
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
}
