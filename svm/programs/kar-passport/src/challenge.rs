//! Verification BondedChallenge — hooks mirror KarPassport.sol §7.2 / instance hooks.

use kargain_bonded_challenge::{
    challenge_pda, conclude_challenge, judge_challenge, open_challenge, transfer_bond_lamports,
    withdraw_challenge, ChallengeAccount, ChallengeConfig, ChallengeEvent, ChallengeHooks,
    JudgeOutcome, CHALLENGE_SEED,
};
use kargain_bonded_challenge::emit::{emit_challenge, ChallengeEmitter};
use kargain_errors::KargainError;
use kargain_events::passport_terminal::{emit_verification_lapsed, emit_verification_stood};
use kar_pro_staking::prove_active_verifier;
use solana_program::pubkey::Pubkey;

use crate::records::{
    append_record_checked, RECORD_TYPE_DISPUTE_WITHDRAWN,
};
use crate::state::{PassportConfig, PassportState, Status, DISPUTE_WINDOW_SECONDS};

pub fn challenge_config_from_passport(cfg: &PassportConfig) -> ChallengeConfig {
    ChallengeConfig {
        forfeit_recipient: cfg.forfeit_recipient,
        window_duration: DISPUTE_WINDOW_SECONDS,
        configured: cfg.forfeit_recipient != [0u8; 32],
    }
}

pub fn check_open_challenge(
    asset_exists: bool,
    burned: bool,
    custody_locked: bool,
    status: Status,
) -> Result<(), KargainError> {
    if !asset_exists || burned {
        return Err(KargainError::NonexistentToken);
    }
    if custody_locked {
        return Err(KargainError::PassportBridgedAway);
    }
    if status != Status::Verified {
        return Err(KargainError::InvalidStatus);
    }
    Ok(())
}

pub struct PassportHooks<'a> {
    pub state: &'a mut PassportState,
    pub asset_owner: [u8; 32],
    pub dispute_deposit: u64,
    pub judge_qualified: bool,
    /// Set after withdraw to append dispute_withdrawn record in the handler.
    pub pending_withdraw_record: bool,
}

impl ChallengeHooks for PassportHooks<'_> {
    fn required_bond_amount(&self) -> u64 {
        self.dispute_deposit
    }

    fn require_challenge_action_allowed(&self, _subject_id: &[u8; 32]) -> Result<(), KargainError> {
        if self.state.custody_locked {
            return Err(KargainError::PassportBridgedAway);
        }
        if self.state.burned {
            return Err(KargainError::NonexistentToken);
        }
        Ok(())
    }

    fn is_eligible_challenger(&self, _subject_id: &[u8; 32], _challenger: &[u8; 32]) -> bool {
        true
    }

    fn is_qualified_judge(&self, _subject_id: &[u8; 32], _judge: &[u8; 32]) -> bool {
        self.judge_qualified
    }

    fn is_excluded_judge(
        &self,
        _subject_id: &[u8; 32],
        challenger: &[u8; 32],
        judge: &[u8; 32],
    ) -> bool {
        judge == challenger || judge == &self.asset_owner || judge == &self.state.verifier
    }

    fn on_upheld(&mut self, _subject_id: &[u8; 32], _challenger: &[u8; 32], _judge: &[u8; 32]) {
        lapse_verification(self.state);
    }

    fn on_rejected(&mut self, _subject_id: &[u8; 32], _challenger: &[u8; 32], _judge: &[u8; 32]) {
        self.state.status = Status::Verified;
    }

    fn on_expired(&mut self, _subject_id: &[u8; 32], _challenger: &[u8; 32]) {
        lapse_verification(self.state);
    }

    fn on_withdrawn(&mut self, _subject_id: &[u8; 32], _challenger: &[u8; 32]) {
        self.state.status = Status::Verified;
        self.pending_withdraw_record = true;
    }
}

pub fn lapse_verification(state: &mut PassportState) {
    state.status = Status::Unverified;
    state.verifier = [0u8; 32];
    state.verified_at = 0;
}

pub fn emit_challenge_event(ev: &ChallengeEvent) {
    emit_challenge(ChallengeEmitter::KarPassport, ev);
}

pub fn challenge_pda_for(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    challenge_pda(program_id, token_id)
}

pub fn challenge_seeds(token_id: &[u8; 32], bump: u8) -> Vec<u8> {
    let mut v = Vec::from(CHALLENGE_SEED);
    v.extend_from_slice(token_id);
    v.push(bump);
    v
}

pub fn require_active_judge(
    stake_data: Option<&[u8]>,
    judge: &[u8; 32],
    stake_owned_by_staking: bool,
    stake_key: Option<&Pubkey>,
    staking_program: &Pubkey,
) -> Result<bool, KargainError> {
    prove_active_verifier(
        stake_data,
        judge,
        stake_owned_by_staking,
        stake_key,
        staking_program,
    )?;
    Ok(true)
}

pub fn transfer_bond(
    from_lamports: &mut u64,
    to_lamports: &mut u64,
    amount: u64,
) -> Result<(), KargainError> {
    transfer_bond_lamports(from_lamports, to_lamports, amount)
}

pub fn run_open_challenge<H: ChallengeHooks>(
    config: &ChallengeConfig,
    hooks: &H,
    subject_id: [u8; 32],
    challenger: [u8; 32],
    value: u64,
    now: u64,
    bump: u8,
) -> Result<(ChallengeAccount, ChallengeEvent), KargainError> {
    open_challenge(config, hooks, subject_id, challenger, value, now, bump)
}

pub fn run_withdraw_challenge<H: ChallengeHooks>(
    account: &mut ChallengeAccount,
    hooks: &mut H,
    caller: [u8; 32],
    now: u64,
) -> Result<(ChallengeEvent, kargain_bonded_challenge::BondDisposition), KargainError> {
    withdraw_challenge(account, hooks, caller, now)
}

pub fn run_judge_challenge<H: ChallengeHooks>(
    account: &mut ChallengeAccount,
    config: &ChallengeConfig,
    hooks: &mut H,
    judge: [u8; 32],
    outcome: JudgeOutcome,
    now: u64,
) -> Result<(ChallengeEvent, kargain_bonded_challenge::BondDisposition), KargainError> {
    judge_challenge(account, config, hooks, judge, outcome, now)
}

pub fn run_conclude_challenge<H: ChallengeHooks>(
    account: &mut ChallengeAccount,
    config: &ChallengeConfig,
    hooks: &mut H,
    now: u64,
) -> Result<(ChallengeEvent, kargain_bonded_challenge::BondDisposition), KargainError> {
    conclude_challenge(account, config, hooks, now)
}

/// Post-withdraw hook record (Solidity `_onWithdrawn` appends dispute_withdrawn).
pub fn append_dispute_withdrawn_record<'info>(
    program_id: &Pubkey,
    asset: &solana_program::account_info::AccountInfo<'info>,
    state: &mut PassportState,
    record_ai: &solana_program::account_info::AccountInfo<'info>,
    payer: &solana_program::account_info::AccountInfo<'info>,
    system: &solana_program::account_info::AccountInfo<'info>,
    challenger: [u8; 32],
    timestamp: u64,
) -> Result<(), solana_program::program_error::ProgramError> {
    append_record_checked(
        program_id,
        asset,
        state,
        record_ai,
        payer,
        system,
        challenger,
        RECORD_TYPE_DISPUTE_WITHDRAWN.to_string(),
        "Challenge withdrawn by opener".to_string(),
        String::new(),
        timestamp,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::PASSPORT_STATE_DISCRIMINATOR;

    fn verified_state() -> PassportState {
        PassportState {
            discriminator: PASSPORT_STATE_DISCRIMINATOR,
            token_id: [9u8; 32],
            status: Status::Verified,
            verifier: [3u8; 32],
            verified_at: 1,
            custody_locked: false,
            burned: false,
            record_count: 0,
            bump: 1,
        }
    }

    #[test]
    fn open_requires_verified() {
        assert!(check_open_challenge(true, false, false, Status::Verified).is_ok());
        assert_eq!(
            check_open_challenge(true, false, false, Status::Unverified),
            Err(KargainError::InvalidStatus)
        );
        assert_eq!(
            check_open_challenge(true, false, true, Status::Verified),
            Err(KargainError::PassportBridgedAway)
        );
    }

    #[test]
    fn excluded_judge_includes_owner_and_verifier() {
        let mut st = verified_state();
        let mut hooks = PassportHooks {
            state: &mut st,
            asset_owner: [4u8; 32],
            dispute_deposit: 1,
            judge_qualified: true,
            pending_withdraw_record: false,
        };
        assert!(hooks.is_excluded_judge(&[0u8; 32], &[1u8; 32], &[1u8; 32]));
        assert!(hooks.is_excluded_judge(&[0u8; 32], &[2u8; 32], &[4u8; 32]));
        assert!(hooks.is_excluded_judge(&[0u8; 32], &[2u8; 32], &[3u8; 32]));
        assert!(!hooks.is_excluded_judge(&[0u8; 32], &[2u8; 32], &[5u8; 32]));
    }

    #[test]
    fn upheld_lapses_verification() {
        let mut st = verified_state();
        let mut hooks = PassportHooks {
            state: &mut st,
            asset_owner: [4u8; 32],
            dispute_deposit: 1,
            judge_qualified: true,
            pending_withdraw_record: false,
        };
        hooks.on_upheld(&[9u8; 32], &[1u8; 32], &[2u8; 32]);
        assert_eq!(hooks.state.status, Status::Unverified);
        assert_eq!(hooks.state.verifier, [0u8; 32]);
    }

    #[test]
    fn rejected_and_withdrawn_restore_verified() {
        let mut st = verified_state();
        st.status = Status::Disputed;
        let mut hooks = PassportHooks {
            state: &mut st,
            asset_owner: [4u8; 32],
            dispute_deposit: 1,
            judge_qualified: true,
            pending_withdraw_record: false,
        };
        hooks.on_rejected(&[9u8; 32], &[1u8; 32], &[2u8; 32]);
        assert_eq!(hooks.state.status, Status::Verified);
        hooks.state.status = Status::Disputed;
        hooks.on_withdrawn(&[9u8; 32], &[1u8; 32]);
        assert_eq!(hooks.state.status, Status::Verified);
        assert!(hooks.pending_withdraw_record);
    }

    #[test]
    fn challenge_config_from_passport_uses_dispute_window() {
        let cfg = PassportConfig {
            discriminator: [0u8; 8],
            authority: [0u8; 32],
            namespace: 0,
            local_eid: 0,
            endpoint_program: [0u8; 32],
            dispute_deposit: 100,
            staking_program: [0u8; 32],
            bridge_gateway: [0u8; 32],
            forfeit_recipient: [8u8; 32],
            next_token_id: [0u8; 32],
            encumbrance_sources: vec![],
            bump: 0,
        };
        let ch = challenge_config_from_passport(&cfg);
        assert_eq!(ch.window_duration, DISPUTE_WINDOW_SECONDS);
        assert!(ch.configured);
    }
}
