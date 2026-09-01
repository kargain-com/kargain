//! Consignment structured events — compute once, emit via [`kargain_events`].

use crate::{
    CloseReason, Compensation, ConsignmentRecord, Denomination, SplitResult,
};
use kargain_events::generated;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConsignmentEvent {
    ConsignmentOpened {
        token_id: [u8; 32],
        seller: [u8; 32],
        agent: [u8; 32],
        asset: [u8; 32],
        denomination_kind: u8,
        currency_code: [u8; 32],
        floor: u64,
        compensation_form: u8,
        commission_bps: u16,
        price: u64,
        platform_fee_bps: u16,
        opened_at: u64,
    },
    ConsignmentPriceSet {
        token_id: [u8; 32],
        setter: [u8; 32],
        new_price: u64,
    },
    ConsignmentFloorLowered {
        token_id: [u8; 32],
        new_floor: u64,
    },
    ConsignmentCommissionLowered {
        token_id: [u8; 32],
        new_bps: u16,
    },
    ConsignmentClosed {
        token_id: [u8; 32],
        reason: u8,
    },
    ConsignmentSplitPaid {
        token_id: [u8; 32],
        asset: [u8; 32],
        owner_recipient: [u8; 32],
        owner_amount: u64,
        agent_recipient: [u8; 32],
        agent_amount: u64,
        platform_recipient: [u8; 32],
        platform_amount: u64,
    },
    MandateGranted {
        token_id: [u8; 32],
        owner: [u8; 32],
        agent: [u8; 32],
        expiry: u64,
        asset: [u8; 32],
        denomination_kind: u8,
        currency_code: [u8; 32],
        floor: u64,
        compensation_form: u8,
        commission_bps: u16,
    },
    MandateRevoked {
        token_id: [u8; 32],
        owner: [u8; 32],
        prior_agent: [u8; 32],
    },
    RecallRequested {
        token_id: [u8; 32],
        seller: [u8; 32],
        requested_at: u64,
    },
    Paused {
        account: [u8; 32],
    },
    Unpaused {
        account: [u8; 32],
    },
    GuardianSet {
        previous: [u8; 32],
        current: [u8; 32],
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommerceEmitter {
    FixedPriceConsignment,
    AscendingConsignment,
}

pub fn event_opened(record: &ConsignmentRecord) -> ConsignmentEvent {
    ConsignmentEvent::ConsignmentOpened {
        token_id: record.token_id,
        seller: record.seller,
        agent: record.agent,
        asset: record.asset,
        denomination_kind: record.denomination.kind,
        currency_code: record.denomination.currency_code,
        floor: record.floor,
        compensation_form: record.compensation.form,
        commission_bps: record.compensation.commission_bps,
        price: record.price,
        platform_fee_bps: record.platform_fee_bps,
        opened_at: record.opened_at,
    }
}

pub fn event_price_set(token_id: [u8; 32], setter: [u8; 32], new_price: u64) -> ConsignmentEvent {
    ConsignmentEvent::ConsignmentPriceSet {
        token_id,
        setter,
        new_price,
    }
}

pub fn event_floor_lowered(token_id: [u8; 32], new_floor: u64) -> ConsignmentEvent {
    ConsignmentEvent::ConsignmentFloorLowered { token_id, new_floor }
}

pub fn event_commission_lowered(token_id: [u8; 32], new_bps: u16) -> ConsignmentEvent {
    ConsignmentEvent::ConsignmentCommissionLowered {
        token_id,
        new_bps,
    }
}

pub fn event_closed(token_id: [u8; 32], reason: CloseReason) -> ConsignmentEvent {
    ConsignmentEvent::ConsignmentClosed {
        token_id,
        reason: reason as u8,
    }
}

pub fn event_split_paid(
    token_id: [u8; 32],
    asset: [u8; 32],
    platform_recipient: [u8; 32],
    owner_recipient: [u8; 32],
    agent_recipient: [u8; 32],
    split: &SplitResult,
) -> ConsignmentEvent {
    ConsignmentEvent::ConsignmentSplitPaid {
        token_id,
        asset,
        owner_recipient,
        owner_amount: split.owner_amount,
        agent_recipient,
        agent_amount: split.agent_amount,
        platform_recipient,
        platform_amount: split.platform,
    }
}

pub fn emit_commerce(emitter: CommerceEmitter, ev: &ConsignmentEvent) {
    match (emitter, ev) {
        (CommerceEmitter::FixedPriceConsignment, ConsignmentEvent::ConsignmentOpened {
            token_id,
            seller,
            agent,
            asset,
            denomination_kind,
            currency_code,
            floor,
            compensation_form,
            commission_bps,
            price,
            platform_fee_bps,
            opened_at,
        }) => generated::emit_fixed_price_consignment_consignment_opened(
            *token_id,
            *seller,
            *agent,
            *asset,
            *denomination_kind,
            *currency_code,
            *floor,
            *compensation_form,
            *commission_bps,
            *price,
            *platform_fee_bps,
            *opened_at,
        ),
        (CommerceEmitter::AscendingConsignment, ConsignmentEvent::ConsignmentOpened {
            token_id,
            seller,
            agent,
            asset,
            denomination_kind,
            currency_code,
            floor,
            compensation_form,
            commission_bps,
            price,
            platform_fee_bps,
            opened_at,
        }) => generated::emit_ascending_consignment_consignment_opened(
            *token_id,
            *seller,
            *agent,
            *asset,
            *denomination_kind,
            *currency_code,
            *floor,
            *compensation_form,
            *commission_bps,
            *price,
            *platform_fee_bps,
            *opened_at,
        ),
        (
            CommerceEmitter::FixedPriceConsignment,
            ConsignmentEvent::ConsignmentPriceSet {
                token_id,
                setter,
                new_price,
            },
        ) => generated::emit_fixed_price_consignment_consignment_price_set(
            *token_id, *setter, *new_price,
        ),
        (
            CommerceEmitter::AscendingConsignment,
            ConsignmentEvent::ConsignmentPriceSet {
                token_id,
                setter,
                new_price,
            },
        ) => generated::emit_ascending_consignment_consignment_price_set(
            *token_id, *setter, *new_price,
        ),
        (
            CommerceEmitter::FixedPriceConsignment,
            ConsignmentEvent::ConsignmentFloorLowered { token_id, new_floor },
        ) => generated::emit_fixed_price_consignment_consignment_floor_lowered(*token_id, *new_floor),
        (
            CommerceEmitter::AscendingConsignment,
            ConsignmentEvent::ConsignmentFloorLowered { token_id, new_floor },
        ) => generated::emit_ascending_consignment_consignment_floor_lowered(*token_id, *new_floor),
        (
            CommerceEmitter::FixedPriceConsignment,
            ConsignmentEvent::ConsignmentCommissionLowered { token_id, new_bps },
        ) => generated::emit_fixed_price_consignment_consignment_commission_lowered(*token_id, *new_bps),
        (
            CommerceEmitter::AscendingConsignment,
            ConsignmentEvent::ConsignmentCommissionLowered { token_id, new_bps },
        ) => generated::emit_ascending_consignment_consignment_commission_lowered(*token_id, *new_bps),
        (
            CommerceEmitter::FixedPriceConsignment,
            ConsignmentEvent::ConsignmentClosed { token_id, reason },
        ) => generated::emit_fixed_price_consignment_consignment_closed(*token_id, *reason),
        (
            CommerceEmitter::AscendingConsignment,
            ConsignmentEvent::ConsignmentClosed { token_id, reason },
        ) => generated::emit_ascending_consignment_consignment_closed(*token_id, *reason),
        (
            CommerceEmitter::FixedPriceConsignment,
            ConsignmentEvent::ConsignmentSplitPaid {
                token_id,
                asset,
                owner_recipient,
                owner_amount,
                agent_recipient,
                agent_amount,
                platform_recipient,
                platform_amount,
            },
        ) => generated::emit_fixed_price_consignment_consignment_split_paid(
            *token_id,
            *asset,
            *owner_recipient,
            *owner_amount,
            *agent_recipient,
            *agent_amount,
            *platform_recipient,
            *platform_amount,
        ),
        (
            CommerceEmitter::AscendingConsignment,
            ConsignmentEvent::ConsignmentSplitPaid {
                token_id,
                asset,
                owner_recipient,
                owner_amount,
                agent_recipient,
                agent_amount,
                platform_recipient,
                platform_amount,
            },
        ) => generated::emit_ascending_consignment_consignment_split_paid(
            *token_id,
            *asset,
            *owner_recipient,
            *owner_amount,
            *agent_recipient,
            *agent_amount,
            *platform_recipient,
            *platform_amount,
        ),
        (
            CommerceEmitter::FixedPriceConsignment,
            ConsignmentEvent::MandateGranted {
                token_id,
                owner,
                agent,
                expiry,
                asset,
                denomination_kind,
                currency_code,
                floor,
                compensation_form,
                commission_bps,
            },
        ) => generated::emit_fixed_price_consignment_mandate_granted(
            *token_id,
            *owner,
            *agent,
            *expiry,
            *asset,
            *denomination_kind,
            *currency_code,
            *floor,
            *compensation_form,
            *commission_bps,
        ),
        (
            CommerceEmitter::AscendingConsignment,
            ConsignmentEvent::MandateGranted {
                token_id,
                owner,
                agent,
                expiry,
                asset,
                denomination_kind,
                currency_code,
                floor,
                compensation_form,
                commission_bps,
            },
        ) => generated::emit_ascending_consignment_mandate_granted(
            *token_id,
            *owner,
            *agent,
            *expiry,
            *asset,
            *denomination_kind,
            *currency_code,
            *floor,
            *compensation_form,
            *commission_bps,
        ),
        (
            CommerceEmitter::FixedPriceConsignment,
            ConsignmentEvent::MandateRevoked {
                token_id,
                owner,
                prior_agent,
            },
        ) => generated::emit_fixed_price_consignment_mandate_revoked(*token_id, *owner, *prior_agent),
        (
            CommerceEmitter::AscendingConsignment,
            ConsignmentEvent::MandateRevoked {
                token_id,
                owner,
                prior_agent,
            },
        ) => generated::emit_ascending_consignment_mandate_revoked(*token_id, *owner, *prior_agent),
        (
            CommerceEmitter::FixedPriceConsignment,
            ConsignmentEvent::RecallRequested {
                token_id,
                seller,
                requested_at,
            },
        ) => generated::emit_fixed_price_consignment_recall_requested(*token_id, *seller, *requested_at),
        (
            CommerceEmitter::AscendingConsignment,
            ConsignmentEvent::RecallRequested {
                token_id,
                seller,
                requested_at,
            },
        ) => generated::emit_ascending_consignment_recall_requested(*token_id, *seller, *requested_at),
        (CommerceEmitter::FixedPriceConsignment, ConsignmentEvent::Paused { account }) => {
            generated::emit_fixed_price_consignment_paused(*account);
        }
        (CommerceEmitter::AscendingConsignment, ConsignmentEvent::Paused { account }) => {
            generated::emit_ascending_consignment_paused(*account);
        }
        (CommerceEmitter::FixedPriceConsignment, ConsignmentEvent::Unpaused { account }) => {
            generated::emit_fixed_price_consignment_unpaused(*account);
        }
        (CommerceEmitter::AscendingConsignment, ConsignmentEvent::Unpaused { account }) => {
            generated::emit_ascending_consignment_unpaused(*account);
        }
        (
            CommerceEmitter::FixedPriceConsignment,
            ConsignmentEvent::GuardianSet { previous, current },
        ) => generated::emit_fixed_price_consignment_guardian_set(*previous, *current),
        (
            CommerceEmitter::AscendingConsignment,
            ConsignmentEvent::GuardianSet { previous, current },
        ) => generated::emit_ascending_consignment_guardian_set(*previous, *current),
    }
}

/// Mandate grant event from mandate record fields.
pub fn event_mandate_granted(
    token_id: [u8; 32],
    owner: [u8; 32],
    agent: [u8; 32],
    expiry: u64,
    asset: [u8; 32],
    denomination: Denomination,
    floor: u64,
    compensation: Compensation,
) -> ConsignmentEvent {
    ConsignmentEvent::MandateGranted {
        token_id,
        owner,
        agent,
        expiry,
        asset,
        denomination_kind: denomination.kind,
        currency_code: denomination.currency_code,
        floor,
        compensation_form: compensation.form,
        commission_bps: compensation.commission_bps,
    }
}
