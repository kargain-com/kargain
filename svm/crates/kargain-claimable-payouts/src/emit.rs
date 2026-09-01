//! Route [`PayoutEvent`] into [`kargain_events`] (sole log owner).

use crate::PayoutEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PayoutEmitter {
    KarPassport,
    KarProStaking,
    FixedPriceConsignment,
    AscendingConsignment,
}

pub fn emit_payout(emitter: PayoutEmitter, ev: &PayoutEvent) {
    use kargain_events::generated;
    match (emitter, ev) {
        (PayoutEmitter::KarPassport, PayoutEvent::ClaimRecorded { account, asset, amount }) => {
            generated::emit_kar_passport_claim_recorded(*account, *asset, *amount);
        }
        (PayoutEmitter::KarPassport, PayoutEvent::ClaimWithdrawn { account, asset, amount }) => {
            generated::emit_kar_passport_claim_withdrawn(*account, *asset, *amount);
        }
        (PayoutEmitter::KarProStaking, PayoutEvent::ClaimRecorded { account, asset, amount }) => {
            generated::emit_kar_pro_staking_claim_recorded(*account, *asset, *amount);
        }
        (PayoutEmitter::KarProStaking, PayoutEvent::ClaimWithdrawn { account, asset, amount }) => {
            generated::emit_kar_pro_staking_claim_withdrawn(*account, *asset, *amount);
        }
        (
            PayoutEmitter::FixedPriceConsignment,
            PayoutEvent::ClaimRecorded { account, asset, amount },
        ) => generated::emit_fixed_price_consignment_claim_recorded(*account, *asset, *amount),
        (
            PayoutEmitter::FixedPriceConsignment,
            PayoutEvent::ClaimWithdrawn { account, asset, amount },
        ) => generated::emit_fixed_price_consignment_claim_withdrawn(*account, *asset, *amount),
        (
            PayoutEmitter::AscendingConsignment,
            PayoutEvent::ClaimRecorded { account, asset, amount },
        ) => generated::emit_ascending_consignment_claim_recorded(*account, *asset, *amount),
        (
            PayoutEmitter::AscendingConsignment,
            PayoutEvent::ClaimWithdrawn { account, asset, amount },
        ) => generated::emit_ascending_consignment_claim_withdrawn(*account, *asset, *amount),
    }
}
