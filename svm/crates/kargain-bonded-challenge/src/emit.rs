//! Route [`ChallengeEvent`] into [`kargain_events`] (sole log owner).

use crate::{ChallengeEvent, JudgeOutcome};

/// Which on-chain contract family emits challenge logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChallengeEmitter {
    KarPassport,
    AscendingConsignment,
}

pub fn emit_challenge(emitter: ChallengeEmitter, ev: &ChallengeEvent) {
    use kargain_events::generated;
    match (emitter, ev) {
        (
            ChallengeEmitter::KarPassport,
            ChallengeEvent::ChallengeOpened {
                subject_id,
                challenger,
                bond_amount,
                window_duration,
                opened_at,
            },
        ) => generated::emit_kar_passport_challenge_opened(
            *subject_id,
            *challenger,
            *bond_amount,
            *window_duration,
            *opened_at,
        ),
        (
            ChallengeEmitter::KarPassport,
            ChallengeEvent::ChallengeWithdrawn {
                subject_id,
                challenger,
                bond_amount,
                window_duration,
                opened_at,
            },
        ) => generated::emit_kar_passport_challenge_withdrawn(
            *subject_id,
            *challenger,
            *bond_amount,
            *window_duration,
            *opened_at,
        ),
        (
            ChallengeEmitter::KarPassport,
            ChallengeEvent::ChallengeJudged {
                subject_id,
                challenger,
                judge,
                outcome,
                bond_recipient,
                bond_amount,
                window_duration,
                opened_at,
            },
        ) => {
            let outcome_u8 = match outcome {
                JudgeOutcome::Upheld => 0u8,
                JudgeOutcome::Rejected => 1u8,
            };
            generated::emit_kar_passport_challenge_judged(
                *subject_id,
                *challenger,
                *judge,
                outcome_u8,
                *bond_recipient,
                *bond_amount,
                *window_duration,
                *opened_at,
            );
        }
        (
            ChallengeEmitter::KarPassport,
            ChallengeEvent::ChallengeConcluded {
                subject_id,
                challenger,
                bond_recipient,
                bond_amount,
                window_duration,
                opened_at,
            },
        ) => generated::emit_kar_passport_challenge_concluded(
            *subject_id,
            *challenger,
            *bond_recipient,
            *bond_amount,
            *window_duration,
            *opened_at,
        ),
        (
            ChallengeEmitter::AscendingConsignment,
            ChallengeEvent::ChallengeOpened {
                subject_id,
                challenger,
                bond_amount,
                window_duration,
                opened_at,
            },
        ) => generated::emit_ascending_consignment_challenge_opened(
            *subject_id,
            *challenger,
            *bond_amount,
            *window_duration,
            *opened_at,
        ),
        (
            ChallengeEmitter::AscendingConsignment,
            ChallengeEvent::ChallengeWithdrawn {
                subject_id,
                challenger,
                bond_amount,
                window_duration,
                opened_at,
            },
        ) => generated::emit_ascending_consignment_challenge_withdrawn(
            *subject_id,
            *challenger,
            *bond_amount,
            *window_duration,
            *opened_at,
        ),
        (
            ChallengeEmitter::AscendingConsignment,
            ChallengeEvent::ChallengeJudged {
                subject_id,
                challenger,
                judge,
                outcome,
                bond_recipient,
                bond_amount,
                window_duration,
                opened_at,
            },
        ) => {
            let outcome_u8 = match outcome {
                JudgeOutcome::Upheld => 0u8,
                JudgeOutcome::Rejected => 1u8,
            };
            generated::emit_ascending_consignment_challenge_judged(
                *subject_id,
                *challenger,
                *judge,
                outcome_u8,
                *bond_recipient,
                *bond_amount,
                *window_duration,
                *opened_at,
            );
        }
        (
            ChallengeEmitter::AscendingConsignment,
            ChallengeEvent::ChallengeConcluded {
                subject_id,
                challenger,
                bond_recipient,
                bond_amount,
                window_duration,
                opened_at,
            },
        ) => generated::emit_ascending_consignment_challenge_concluded(
            *subject_id,
            *challenger,
            *bond_recipient,
            *bond_amount,
            *window_duration,
            *opened_at,
        ),
    }
}
