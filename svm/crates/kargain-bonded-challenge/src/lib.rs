//! BondedChallenge automaton — mirror of `contracts/lib/BondedChallenge.sol`.
//!
//! Two instances (passport verification, ascending settlement) share this
//! crate via [`ChallengeHooks`]. Check order, error names, and events match
//! Solidity exactly.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_claimable_payouts::{ClaimablePayoutsState, NATIVE_ASSET, PayoutEvent};
use kargain_errors::KargainError;
use std::collections::BTreeMap;

/// JudgeOutcome: Upheld = 0, Rejected = 1 (Solidity ordinals).
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
#[borsh(use_discriminant=true)]
#[repr(u8)]
pub enum JudgeOutcome {
    Upheld = 0,
    Rejected = 1,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct Challenge {
    pub opened_at: u64,
    pub window_duration: u64,
    pub challenger: [u8; 32],
    pub bond_amount: u64,
}

#[derive(Debug, Clone, Default, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct BondedChallengeState {
    pub challenges: BTreeMap<[u8; 32], Challenge>,
    pub forfeit_recipient: [u8; 32],
    pub window_duration: u64,
    pub configured: bool,
    pub total_locked_bonds: u64,
    pub payouts: ClaimablePayoutsState,
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
    Payout(PayoutEvent),
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

impl BondedChallengeState {
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

    pub fn is_challenge_active(&self, subject_id: &[u8; 32]) -> bool {
        self.challenges
            .get(subject_id)
            .map(|c| c.opened_at != 0)
            .unwrap_or(false)
    }

    pub fn open<H: ChallengeHooks>(
        &mut self,
        hooks: &H,
        subject_id: [u8; 32],
        challenger: [u8; 32],
        value: u64,
        now: u64,
    ) -> Result<ChallengeEvent, KargainError> {
        // Order matches Solidity `_openChallenge`.
        if !self.configured {
            return Err(KargainError::ChallengeNotConfigured);
        }
        hooks.require_challenge_action_allowed(&subject_id)?;
        if self.is_challenge_active(&subject_id) {
            return Err(KargainError::DisputeActive);
        }
        if !hooks.is_eligible_challenger(&subject_id, &challenger) {
            return Err(KargainError::NotEligibleChallenger);
        }
        if value != hooks.required_bond_amount() {
            return Err(KargainError::WrongValue);
        }
        let c = Challenge {
            opened_at: now,
            window_duration: self.window_duration,
            challenger,
            bond_amount: value,
        };
        self.total_locked_bonds = self.total_locked_bonds.saturating_add(value);
        self.challenges.insert(subject_id, c);
        Ok(ChallengeEvent::ChallengeOpened {
            subject_id,
            challenger,
            bond_amount: value,
            window_duration: self.window_duration,
            opened_at: now,
        })
    }

    pub fn withdraw<H: ChallengeHooks>(
        &mut self,
        hooks: &mut H,
        subject_id: [u8; 32],
        caller: [u8; 32],
        now: u64,
        push_ok: bool,
    ) -> Result<Vec<ChallengeEvent>, KargainError> {
        hooks.require_challenge_action_allowed(&subject_id)?;
        let c = self.require_active(&subject_id)?;
        if c.challenger != caller {
            return Err(KargainError::NotDisputeOpener);
        }
        if now >= c.opened_at.saturating_add(c.window_duration) {
            return Err(KargainError::DisputeWindowElapsed);
        }
        let bond = c.bond_amount;
        let challenger = c.challenger;
        let window = c.window_duration;
        let opened = c.opened_at;
        // Clear before pay and before terminal (Solidity (a)).
        self.clear(&subject_id, bond);
        let mut events = vec![ChallengeEvent::ChallengeWithdrawn {
            subject_id,
            challenger,
            bond_amount: bond,
            window_duration: window,
            opened_at: opened,
        }];
        if let Some(ev) = self.payouts.pay_native(challenger, bond, push_ok) {
            events.push(ChallengeEvent::Payout(ev));
        }
        hooks.on_withdrawn(&subject_id, &challenger);
        let _ = NATIVE_ASSET;
        Ok(events)
    }

    pub fn judge<H: ChallengeHooks>(
        &mut self,
        hooks: &mut H,
        subject_id: [u8; 32],
        judge: [u8; 32],
        outcome: JudgeOutcome,
        now: u64,
        push_ok: bool,
    ) -> Result<Vec<ChallengeEvent>, KargainError> {
        hooks.require_challenge_action_allowed(&subject_id)?;
        let c = self.require_active(&subject_id)?;
        if now >= c.opened_at.saturating_add(c.window_duration) {
            return Err(KargainError::DisputeWindowElapsed);
        }
        // Exclusion before qualification (§13a.1).
        if hooks.is_excluded_judge(&subject_id, &c.challenger, &judge) {
            return Err(KargainError::CannotResolveOwnDispute);
        }
        if !hooks.is_qualified_judge(&subject_id, &judge) {
            return Err(KargainError::NotQualifiedJudge);
        }
        let bond_recipient = match outcome {
            JudgeOutcome::Upheld => c.challenger,
            JudgeOutcome::Rejected => self.forfeit_recipient,
        };
        if bond_recipient == judge {
            return Err(KargainError::CannotRouteBondToJudge);
        }
        let bond = c.bond_amount;
        let challenger = c.challenger;
        let window = c.window_duration;
        let opened = c.opened_at;
        self.clear(&subject_id, bond);
        let mut events = vec![ChallengeEvent::ChallengeJudged {
            subject_id,
            challenger,
            judge,
            outcome,
            bond_recipient,
            bond_amount: bond,
            window_duration: window,
            opened_at: opened,
        }];
        if let Some(ev) = self.payouts.pay_native(bond_recipient, bond, push_ok) {
            events.push(ChallengeEvent::Payout(ev));
        }
        match outcome {
            JudgeOutcome::Upheld => hooks.on_upheld(&subject_id, &challenger, &judge),
            JudgeOutcome::Rejected => hooks.on_rejected(&subject_id, &challenger, &judge),
        }
        Ok(events)
    }

    pub fn conclude<H: ChallengeHooks>(
        &mut self,
        hooks: &mut H,
        subject_id: [u8; 32],
        now: u64,
        push_ok: bool,
    ) -> Result<Vec<ChallengeEvent>, KargainError> {
        hooks.require_challenge_action_allowed(&subject_id)?;
        let c = self.require_active(&subject_id)?;
        if now < c.opened_at.saturating_add(c.window_duration) {
            return Err(KargainError::DisputeWindowActive);
        }
        let bond = c.bond_amount;
        let challenger = c.challenger;
        let window = c.window_duration;
        let opened = c.opened_at;
        let recipient = self.forfeit_recipient;
        self.clear(&subject_id, bond);
        let mut events = vec![ChallengeEvent::ChallengeConcluded {
            subject_id,
            challenger,
            bond_recipient: recipient,
            bond_amount: bond,
            window_duration: window,
            opened_at: opened,
        }];
        if let Some(ev) = self.payouts.pay_native(recipient, bond, push_ok) {
            events.push(ChallengeEvent::Payout(ev));
        }
        hooks.on_expired(&subject_id, &challenger);
        Ok(events)
    }

    fn require_active(&self, subject_id: &[u8; 32]) -> Result<Challenge, KargainError> {
        match self.challenges.get(subject_id) {
            Some(c) if c.opened_at != 0 => Ok(c.clone()),
            _ => Err(KargainError::NoActiveDispute),
        }
    }

    fn clear(&mut self, subject_id: &[u8; 32], bond: u64) {
        self.challenges.remove(subject_id);
        self.total_locked_bonds = self.total_locked_bonds.saturating_sub(bond);
    }
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
        let mut s = BondedChallengeState::default();
        s.configure([9u8; 32], 100).unwrap();
        let hooks = TestHooks {
            bond: 50,
            qualified: true,
        };
        assert_eq!(
            s.open(&hooks, [1u8; 32], [2u8; 32], 49, 0),
            Err(KargainError::WrongValue)
        );
    }

    #[test]
    fn exclusion_before_qualification() {
        let mut s = BondedChallengeState::default();
        s.configure([9u8; 32], 100).unwrap();
        let mut hooks = TestHooks {
            bond: 50,
            qualified: false,
        };
        s.open(&hooks, [1u8; 32], [2u8; 32], 50, 10).unwrap();
        // Same as challenger → CannotResolveOwnDispute (not NotQualifiedJudge)
        assert_eq!(
            s.judge(&mut hooks, [1u8; 32], [2u8; 32], JudgeOutcome::Upheld, 11, true),
            Err(KargainError::CannotResolveOwnDispute)
        );
    }

    #[test]
    fn judge_outcome_ordinals() {
        assert_eq!(JudgeOutcome::Upheld as u8, 0);
        assert_eq!(JudgeOutcome::Rejected as u8, 1);
    }
}
