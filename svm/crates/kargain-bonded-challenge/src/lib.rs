//! BondedChallenge — per-subject challenge PDA; bond = lamports (SPEC D-01/D-04/D-15).
//!
//! No nested ClaimablePayouts, no global locked totals, no `push_ok`. Native bond
//! settlement always moves lamports (cannot fail → claim). `JudgeOutcome` is the
//! judge's choice (EVM parity), not a transfer-outcome parameter.

pub mod emit;

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_errors::KargainError;
use solana_program::pubkey::Pubkey;

pub const CHALLENGE_SEED: &[u8] = b"challenge";
pub const CHALLENGE_ACCOUNT_DISCRIMINATOR: [u8; 8] = *b"kp_chl\0\0";

/// JudgeOutcome: Upheld = 0, Rejected = 1 (Solidity ordinals).
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum JudgeOutcome {
    Upheld = 0,
    Rejected = 1,
}

/// One PDA per subject — holds bond lamports above rent.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct ChallengeAccount {
    pub discriminator: [u8; 8],
    pub subject_id: [u8; 32],
    pub opened_at: u64,
    pub window_duration: u64,
    pub challenger: [u8; 32],
    pub bond_amount: u64,
    pub bump: u8,
}

impl ChallengeAccount {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 32 + 8 + 1;

    pub fn is_active(&self) -> bool {
        self.opened_at != 0
    }
}

/// Instance configuration (lives on program config, not the challenge PDA).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq, Default)]
pub struct ChallengeConfig {
    pub forfeit_recipient: [u8; 32],
    pub window_duration: u64,
    pub configured: bool,
}

pub fn challenge_pda(program_id: &Pubkey, subject_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CHALLENGE_SEED, subject_id], program_id)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChallengeEvent {
    ChallengeOpened {
        subject_id: [u8; 32],
        challenger: [u8; 32],
        bond_amount: u64,
        window_duration: u64,
        opened_at: u64,
    },
    ChallengeWithdrawn {
        subject_id: [u8; 32],
        challenger: [u8; 32],
        bond_amount: u64,
        window_duration: u64,
        opened_at: u64,
    },
    ChallengeJudged {
        subject_id: [u8; 32],
        challenger: [u8; 32],
        judge: [u8; 32],
        outcome: JudgeOutcome,
        bond_recipient: [u8; 32],
        bond_amount: u64,
        window_duration: u64,
        opened_at: u64,
    },
    ChallengeConcluded {
        subject_id: [u8; 32],
        challenger: [u8; 32],
        bond_recipient: [u8; 32],
        bond_amount: u64,
        window_duration: u64,
        opened_at: u64,
    },
}

/// Who receives the bond lamports after a terminal (always native; no claim).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BondDisposition {
    pub recipient: [u8; 32],
    pub amount: u64,
}

/// Instance hooks — same virtuals as Solidity BondedChallenge.
pub trait ChallengeHooks {
    fn required_bond_amount(&self) -> u64;
    fn require_challenge_action_allowed(&self, subject_id: &[u8; 32]) -> Result<(), KargainError>;
    fn is_eligible_challenger(&self, subject_id: &[u8; 32], challenger: &[u8; 32]) -> bool;
    fn is_qualified_judge(&self, subject_id: &[u8; 32], judge: &[u8; 32]) -> bool;
    fn is_excluded_judge(
        &self,
        subject_id: &[u8; 32],
        challenger: &[u8; 32],
        judge: &[u8; 32],
    ) -> bool;
    fn on_upheld(&mut self, subject_id: &[u8; 32], challenger: &[u8; 32], judge: &[u8; 32]);
    fn on_rejected(&mut self, subject_id: &[u8; 32], challenger: &[u8; 32], judge: &[u8; 32]);
    fn on_expired(&mut self, subject_id: &[u8; 32], challenger: &[u8; 32]);
    fn on_withdrawn(&mut self, subject_id: &[u8; 32], challenger: &[u8; 32]);
}

impl ChallengeConfig {
    pub fn configure(
        &mut self,
        forfeit_recipient: [u8; 32],
        window_duration: u64,
    ) -> Result<(), KargainError> {
        if self.configured {
            return Err(KargainError::ChallengeAlreadyConfigured);
        }
        if forfeit_recipient == [0u8; 32] {
            return Err(KargainError::ZeroForfeitRecipient);
        }
        if window_duration == 0 {
            return Err(KargainError::ZeroChallengeWindow);
        }
        self.forfeit_recipient = forfeit_recipient;
        self.window_duration = window_duration;
        self.configured = true;
        Ok(())
    }
}

/// Open: validate and return initialized challenge account data.
/// Caller funds the PDA with rent + `value` lamports in the same instruction.
pub fn open_challenge<H: ChallengeHooks>(
    config: &ChallengeConfig,
    hooks: &H,
    subject_id: [u8; 32],
    challenger: [u8; 32],
    value: u64,
    now: u64,
    bump: u8,
) -> Result<(ChallengeAccount, ChallengeEvent), KargainError> {
    if !config.configured {
        return Err(KargainError::ChallengeNotConfigured);
    }
    hooks.require_challenge_action_allowed(&subject_id)?;
    if !hooks.is_eligible_challenger(&subject_id, &challenger) {
        return Err(KargainError::NotEligibleChallenger);
    }
    if value != hooks.required_bond_amount() {
        return Err(KargainError::WrongValue);
    }
    let account = ChallengeAccount {
        discriminator: CHALLENGE_ACCOUNT_DISCRIMINATOR,
        subject_id,
        opened_at: now,
        window_duration: config.window_duration,
        challenger,
        bond_amount: value,
        bump,
    };
    Ok((
        account,
        ChallengeEvent::ChallengeOpened {
            subject_id,
            challenger,
            bond_amount: value,
            window_duration: config.window_duration,
            opened_at: now,
        },
    ))
}

fn require_active(account: &ChallengeAccount) -> Result<(), KargainError> {
    if account.is_active() {
        Ok(())
    } else {
        Err(KargainError::NoActiveDispute)
    }
}

fn clear(account: &mut ChallengeAccount) {
    account.opened_at = 0;
    account.bond_amount = 0;
    account.challenger = [0u8; 32];
    account.window_duration = 0;
}

/// Withdraw before window — bond returns to challenger.
pub fn withdraw_challenge<H: ChallengeHooks>(
    account: &mut ChallengeAccount,
    hooks: &mut H,
    caller: [u8; 32],
    now: u64,
) -> Result<(ChallengeEvent, BondDisposition), KargainError> {
    hooks.require_challenge_action_allowed(&account.subject_id)?;
    require_active(account)?;
    if account.challenger != caller {
        return Err(KargainError::NotDisputeOpener);
    }
    let end = account
        .opened_at
        .checked_add(account.window_duration)
        .ok_or(KargainError::ArithmeticOverflow)?;
    if now >= end {
        return Err(KargainError::DisputeWindowElapsed);
    }
    let bond = account.bond_amount;
    let challenger = account.challenger;
    let window = account.window_duration;
    let opened = account.opened_at;
    let subject_id = account.subject_id;
    clear(account);
    hooks.on_withdrawn(&subject_id, &challenger);
    Ok((
        ChallengeEvent::ChallengeWithdrawn {
            subject_id,
            challenger,
            bond_amount: bond,
            window_duration: window,
            opened_at: opened,
        },
        BondDisposition {
            recipient: challenger,
            amount: bond,
        },
    ))
}

/// Judge before window — bond to challenger (Upheld) or forfeit recipient (Rejected).
pub fn judge_challenge<H: ChallengeHooks>(
    account: &mut ChallengeAccount,
    config: &ChallengeConfig,
    hooks: &mut H,
    judge: [u8; 32],
    outcome: JudgeOutcome,
    now: u64,
) -> Result<(ChallengeEvent, BondDisposition), KargainError> {
    hooks.require_challenge_action_allowed(&account.subject_id)?;
    require_active(account)?;
    let end = account
        .opened_at
        .checked_add(account.window_duration)
        .ok_or(KargainError::ArithmeticOverflow)?;
    if now >= end {
        return Err(KargainError::DisputeWindowElapsed);
    }
    if hooks.is_excluded_judge(&account.subject_id, &account.challenger, &judge) {
        return Err(KargainError::CannotResolveOwnDispute);
    }
    if !hooks.is_qualified_judge(&account.subject_id, &judge) {
        return Err(KargainError::NotQualifiedJudge);
    }
    let bond_recipient = match outcome {
        JudgeOutcome::Upheld => account.challenger,
        JudgeOutcome::Rejected => config.forfeit_recipient,
    };
    if bond_recipient == judge {
        return Err(KargainError::CannotRouteBondToJudge);
    }
    let bond = account.bond_amount;
    let challenger = account.challenger;
    let window = account.window_duration;
    let opened = account.opened_at;
    let subject_id = account.subject_id;
    clear(account);
    match outcome {
        JudgeOutcome::Upheld => hooks.on_upheld(&subject_id, &challenger, &judge),
        JudgeOutcome::Rejected => hooks.on_rejected(&subject_id, &challenger, &judge),
    }
    Ok((
        ChallengeEvent::ChallengeJudged {
            subject_id,
            challenger,
            judge,
            outcome,
            bond_recipient,
            bond_amount: bond,
            window_duration: window,
            opened_at: opened,
        },
        BondDisposition {
            recipient: bond_recipient,
            amount: bond,
        },
    ))
}

/// Conclude after window — bond to forfeit recipient.
pub fn conclude_challenge<H: ChallengeHooks>(
    account: &mut ChallengeAccount,
    config: &ChallengeConfig,
    hooks: &mut H,
    now: u64,
) -> Result<(ChallengeEvent, BondDisposition), KargainError> {
    hooks.require_challenge_action_allowed(&account.subject_id)?;
    require_active(account)?;
    let end = account
        .opened_at
        .checked_add(account.window_duration)
        .ok_or(KargainError::ArithmeticOverflow)?;
    if now < end {
        return Err(KargainError::DisputeWindowActive);
    }
    let bond = account.bond_amount;
    let challenger = account.challenger;
    let window = account.window_duration;
    let opened = account.opened_at;
    let subject_id = account.subject_id;
    let recipient = config.forfeit_recipient;
    clear(account);
    hooks.on_expired(&subject_id, &challenger);
    Ok((
        ChallengeEvent::ChallengeConcluded {
            subject_id,
            challenger,
            bond_recipient: recipient,
            bond_amount: bond,
            window_duration: window,
            opened_at: opened,
        },
        BondDisposition {
            recipient,
            amount: bond,
        },
    ))
}

/// Move `amount` lamports from challenge PDA to recipient (native; no claim fallback).
pub fn transfer_bond_lamports(
    from_lamports: &mut u64,
    to_lamports: &mut u64,
    amount: u64,
) -> Result<(), KargainError> {
    *from_lamports = from_lamports
        .checked_sub(amount)
        .ok_or(KargainError::TransferFailed)?;
    *to_lamports = to_lamports
        .checked_add(amount)
        .ok_or(KargainError::ArithmeticOverflow)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestHooks {
        bond: u64,
        qualified: bool,
    }

    impl ChallengeHooks for TestHooks {
        fn required_bond_amount(&self) -> u64 {
            self.bond
        }
        fn require_challenge_action_allowed(&self, _: &[u8; 32]) -> Result<(), KargainError> {
            Ok(())
        }
        fn is_eligible_challenger(&self, _: &[u8; 32], _: &[u8; 32]) -> bool {
            true
        }
        fn is_qualified_judge(&self, _: &[u8; 32], _: &[u8; 32]) -> bool {
            self.qualified
        }
        fn is_excluded_judge(&self, _: &[u8; 32], c: &[u8; 32], j: &[u8; 32]) -> bool {
            c == j
        }
        fn on_upheld(&mut self, _: &[u8; 32], _: &[u8; 32], _: &[u8; 32]) {}
        fn on_rejected(&mut self, _: &[u8; 32], _: &[u8; 32], _: &[u8; 32]) {}
        fn on_expired(&mut self, _: &[u8; 32], _: &[u8; 32]) {}
        fn on_withdrawn(&mut self, _: &[u8; 32], _: &[u8; 32]) {}
    }

    #[test]
    fn open_wrong_value() {
        let mut config = ChallengeConfig::default();
        config.configure([9u8; 32], 100).unwrap();
        let hooks = TestHooks {
            bond: 50,
            qualified: true,
        };
        assert_eq!(
            open_challenge(&config, &hooks, [1u8; 32], [2u8; 32], 49, 0, 255)
                .err(),
            Some(KargainError::WrongValue)
        );
    }

    #[test]
    fn exclusion_before_qualification() {
        let mut config = ChallengeConfig::default();
        config.configure([9u8; 32], 100).unwrap();
        let mut hooks = TestHooks {
            bond: 50,
            qualified: false,
        };
        let (mut account, _) =
            open_challenge(&config, &hooks, [1u8; 32], [2u8; 32], 50, 10, 255).unwrap();
        assert_eq!(
            judge_challenge(
                &mut account,
                &config,
                &mut hooks,
                [2u8; 32],
                JudgeOutcome::Upheld,
                11,
            )
            .err(),
            Some(KargainError::CannotResolveOwnDispute)
        );
    }

    #[test]
    fn judge_outcome_ordinals() {
        assert_eq!(JudgeOutcome::Upheld as u8, 0);
        assert_eq!(JudgeOutcome::Rejected as u8, 1);
    }

    #[test]
    fn bond_transfer_checked() {
        let mut from = 100u64;
        let mut to = 0u64;
        transfer_bond_lamports(&mut from, &mut to, 40).unwrap();
        assert_eq!(from, 60);
        assert_eq!(to, 40);
        assert_eq!(
            transfer_bond_lamports(&mut from, &mut to, 100),
            Err(KargainError::TransferFailed)
        );
    }

    #[test]
    fn withdraw_returns_disposition_no_push_ok() {
        let mut config = ChallengeConfig::default();
        config.configure([9u8; 32], 100).unwrap();
        let mut hooks = TestHooks {
            bond: 50,
            qualified: true,
        };
        let (mut account, _) =
            open_challenge(&config, &hooks, [1u8; 32], [2u8; 32], 50, 10, 255).unwrap();
        let (_, disp) = withdraw_challenge(&mut account, &mut hooks, [2u8; 32], 11).unwrap();
        assert_eq!(
            disp,
            BondDisposition {
                recipient: [2u8; 32],
                amount: 50
            }
        );
        assert!(!account.is_active());
    }
}
