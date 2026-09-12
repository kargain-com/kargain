//! Exhaustive samples for all six commercial instruction enums.
//!
//! `layout_and_sample_*` matches have **no** wildcard arm: adding a Rust variant
//! without a sample arm fails to compile.

use kar_ascending::ix::AscendingIx;
use kar_fixed_price::ix::FixedPriceIx;
use kar_gateway::instruction::GatewayIx;
use kar_passport::instruction::PassportIx;
use kar_pro_pass::instruction::PassIx;
use kar_pro_staking::instruction::StakingIx;
use kargain_price::PRICE_UPDATE_V2_LEN;
use serde_json::{Map, Value};

use crate::{
    b32, entry_from_borsh, field_bool, field_fixed, field_string, field_u128, field_u16, field_u32,
    field_u64, field_u8, field_vec_u8, sample_bool, sample_bytes, sample_string, sample_u128,
    sample_u16, sample_u32, sample_u64, sample_u8, ManifestEntry,
};

fn map_of(pairs: &[(&str, Value)]) -> Map<String, Value> {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert((*k).into(), v.clone());
    }
    m
}

pub fn all_entries() -> Vec<ManifestEntry> {
    let mut out = Vec::with_capacity(98);
    out.extend(passport_entries());
    out.extend(gateway_entries());
    out.extend(staking_entries());
    out.extend(pass_entries());
    out.extend(fixed_price_entries());
    out.extend(ascending_entries());
    out
}

// ---- Passport (21) ----

fn passport_entries() -> Vec<ManifestEntry> {
    let samples = passport_samples();
    samples
        .into_iter()
        .map(|ix| layout_and_sample_passport(ix))
        .collect()
}

fn passport_samples() -> Vec<PassportIx> {
    vec![
        PassportIx::Initialize {
            namespace: 2000040168,
            local_eid: 40168,
            endpoint_program: b32(0x11),
            dispute_deposit: 1_000_000_000,
            staking_program: b32(0x22),
            forfeit_recipient: b32(0x33),
        },
        PassportIx::SetBridgeGateway {
            gateway: b32(0x44),
        },
        PassportIx::MintPassport {
            uri: "ar://sample-uri".into(),
        },
        PassportIx::SetPassportUri {
            token_id: b32(0x55),
            uri: "ar://uri-2".into(),
        },
        PassportIx::May {
            token_id: b32(0x56),
            intent: 1,
        },
        PassportIx::AppendRecord {
            token_id: b32(0x57),
            record_type: "service".into(),
            description: "desc".into(),
            evidence_cid: "ar://ev".into(),
        },
        PassportIx::SetCustodyLock {
            token_id: b32(0x58),
            locked: true,
        },
        PassportIx::BridgeMint {
            to: b32(0x59),
            token_id: b32(0x5a),
            uri: "ar://bridge".into(),
        },
        PassportIx::BridgeBurn {
            token_id: b32(0x5b),
        },
        PassportIx::BridgeResetOnUnlock {
            token_id: b32(0x5c),
            uri: "ar://reset".into(),
        },
        PassportIx::SetStakingProgram {
            staking_program: b32(0x5d),
        },
        PassportIx::VerifyPassport {
            token_id: b32(0x5e),
        },
        PassportIx::OpenChallenge {
            token_id: b32(0x5f),
        },
        PassportIx::WithdrawChallenge {
            token_id: b32(0x60),
        },
        PassportIx::JudgeChallenge {
            token_id: b32(0x61),
            outcome: 2,
        },
        PassportIx::ConcludeChallenge {
            token_id: b32(0x62),
        },
        PassportIx::WithdrawClaim,
        PassportIx::SetDisputeDeposit {
            dispute_deposit: 2_000_000_000,
        },
        PassportIx::ReportDiscrepancy {
            token_id: b32(0x63),
            description: "disc".into(),
            evidence_cid: "ar://d".into(),
        },
        PassportIx::AppendAttestation {
            token_id: b32(0x64),
            description: "att".into(),
            evidence_cid: "ar://a".into(),
        },
        PassportIx::TransferPassport {
            token_id: b32(0x65),
        },
    ]
}

fn layout_and_sample_passport(ix: PassportIx) -> ManifestEntry {
    let (name, fields, sample) = match &ix {
        PassportIx::Initialize {
            namespace,
            local_eid,
            endpoint_program,
            dispute_deposit,
            staking_program,
            forfeit_recipient,
        } => (
            "Initialize",
            vec![
                field_u128("namespace"),
                field_u32("local_eid"),
                field_fixed("endpoint_program", 32),
                field_u64("dispute_deposit"),
                field_fixed("staking_program", 32),
                field_fixed("forfeit_recipient", 32),
            ],
            map_of(&[
                ("namespace", sample_u128(*namespace)),
                ("local_eid", sample_u32(*local_eid)),
                ("endpoint_program", sample_bytes(endpoint_program)),
                ("dispute_deposit", sample_u64(*dispute_deposit)),
                ("staking_program", sample_bytes(staking_program)),
                ("forfeit_recipient", sample_bytes(forfeit_recipient)),
            ]),
        ),
        PassportIx::SetBridgeGateway { gateway } => (
            "SetBridgeGateway",
            vec![field_fixed("gateway", 32)],
            map_of(&[("gateway", sample_bytes(gateway))]),
        ),
        PassportIx::MintPassport { uri } => (
            "MintPassport",
            vec![field_string("uri")],
            map_of(&[("uri", sample_string(uri))]),
        ),
        PassportIx::SetPassportUri { token_id, uri } => (
            "SetPassportUri",
            vec![field_fixed("token_id", 32), field_string("uri")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("uri", sample_string(uri)),
            ]),
        ),
        PassportIx::May { token_id, intent } => (
            "May",
            vec![field_fixed("token_id", 32), field_u8("intent")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("intent", sample_u8(*intent)),
            ]),
        ),
        PassportIx::AppendRecord {
            token_id,
            record_type,
            description,
            evidence_cid,
        } => (
            "AppendRecord",
            vec![
                field_fixed("token_id", 32),
                field_string("record_type"),
                field_string("description"),
                field_string("evidence_cid"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("record_type", sample_string(record_type)),
                ("description", sample_string(description)),
                ("evidence_cid", sample_string(evidence_cid)),
            ]),
        ),
        PassportIx::SetCustodyLock { token_id, locked } => (
            "SetCustodyLock",
            vec![field_fixed("token_id", 32), field_bool("locked")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("locked", sample_bool(*locked)),
            ]),
        ),
        PassportIx::BridgeMint {
            to,
            token_id,
            uri,
        } => (
            "BridgeMint",
            vec![
                field_fixed("to", 32),
                field_fixed("token_id", 32),
                field_string("uri"),
            ],
            map_of(&[
                ("to", sample_bytes(to)),
                ("token_id", sample_bytes(token_id)),
                ("uri", sample_string(uri)),
            ]),
        ),
        PassportIx::BridgeBurn { token_id } => (
            "BridgeBurn",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        PassportIx::BridgeResetOnUnlock { token_id, uri } => (
            "BridgeResetOnUnlock",
            vec![field_fixed("token_id", 32), field_string("uri")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("uri", sample_string(uri)),
            ]),
        ),
        PassportIx::SetStakingProgram { staking_program } => (
            "SetStakingProgram",
            vec![field_fixed("staking_program", 32)],
            map_of(&[("staking_program", sample_bytes(staking_program))]),
        ),
        PassportIx::VerifyPassport { token_id } => (
            "VerifyPassport",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        PassportIx::OpenChallenge { token_id } => (
            "OpenChallenge",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        PassportIx::WithdrawChallenge { token_id } => (
            "WithdrawChallenge",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        PassportIx::JudgeChallenge { token_id, outcome } => (
            "JudgeChallenge",
            vec![field_fixed("token_id", 32), field_u8("outcome")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("outcome", sample_u8(*outcome)),
            ]),
        ),
        PassportIx::ConcludeChallenge { token_id } => (
            "ConcludeChallenge",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        PassportIx::WithdrawClaim => ("WithdrawClaim", vec![], Map::new()),
        PassportIx::SetDisputeDeposit { dispute_deposit } => (
            "SetDisputeDeposit",
            vec![field_u64("dispute_deposit")],
            map_of(&[("dispute_deposit", sample_u64(*dispute_deposit))]),
        ),
        PassportIx::ReportDiscrepancy {
            token_id,
            description,
            evidence_cid,
        } => (
            "ReportDiscrepancy",
            vec![
                field_fixed("token_id", 32),
                field_string("description"),
                field_string("evidence_cid"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("description", sample_string(description)),
                ("evidence_cid", sample_string(evidence_cid)),
            ]),
        ),
        PassportIx::AppendAttestation {
            token_id,
            description,
            evidence_cid,
        } => (
            "AppendAttestation",
            vec![
                field_fixed("token_id", 32),
                field_string("description"),
                field_string("evidence_cid"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("description", sample_string(description)),
                ("evidence_cid", sample_string(evidence_cid)),
            ]),
        ),
        PassportIx::TransferPassport { token_id } => (
            "TransferPassport",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
    };
    entry_from_borsh("kar-passport", "PassportIx", name, fields, sample, &ix)
}

// ---- Gateway (8) ----

fn gateway_entries() -> Vec<ManifestEntry> {
    gateway_samples()
        .into_iter()
        .map(layout_and_sample_gateway)
        .collect()
}

fn gateway_samples() -> Vec<GatewayIx> {
    vec![
        GatewayIx::Initialize {
            local_eid: 40168,
            endpoint_program: b32(0x71),
            passport_program: b32(0x72),
            namespace: 2000040168,
        },
        GatewayIx::Send {
            dst_eid: 40245,
            to: b32(0x73),
            token_id: b32(0x74),
            native_fee: 5000,
            options: vec![0xa5, 0xa5, 0x01],
        },
        GatewayIx::LzReceive {
            src_eid: 40245,
            sender: b32(0x75),
            nonce: 7,
            guid: b32(0x76),
            message: vec![0x01, 0x02, 0x03, 0x04],
        },
        GatewayIx::RecoverLockedHome {
            token_id: b32(0x77),
            to: b32(0x78),
        },
        GatewayIx::LzReceiveTypes {
            message: vec![0x10, 0x20],
        },
        GatewayIx::RegisterOApp {
            delegate: b32(0x79),
        },
        GatewayIx::SetPeer {
            remote_eid: 40245,
            peer: b32(0x7a),
        },
        GatewayIx::InitLzReceiveTypes,
    ]
}

fn layout_and_sample_gateway(ix: GatewayIx) -> ManifestEntry {
    let (name, fields, sample) = match &ix {
        GatewayIx::Initialize {
            local_eid,
            endpoint_program,
            passport_program,
            namespace,
        } => (
            "Initialize",
            vec![
                field_u32("local_eid"),
                field_fixed("endpoint_program", 32),
                field_fixed("passport_program", 32),
                field_u128("namespace"),
            ],
            map_of(&[
                ("local_eid", sample_u32(*local_eid)),
                ("endpoint_program", sample_bytes(endpoint_program)),
                ("passport_program", sample_bytes(passport_program)),
                ("namespace", sample_u128(*namespace)),
            ]),
        ),
        GatewayIx::Send {
            dst_eid,
            to,
            token_id,
            native_fee,
            options,
        } => (
            "Send",
            vec![
                field_u32("dst_eid"),
                field_fixed("to", 32),
                field_fixed("token_id", 32),
                field_u64("native_fee"),
                field_vec_u8("options"),
            ],
            map_of(&[
                ("dst_eid", sample_u32(*dst_eid)),
                ("to", sample_bytes(to)),
                ("token_id", sample_bytes(token_id)),
                ("native_fee", sample_u64(*native_fee)),
                ("options", sample_bytes(options)),
            ]),
        ),
        GatewayIx::LzReceive {
            src_eid,
            sender,
            nonce,
            guid,
            message,
        } => (
            "LzReceive",
            vec![
                field_u32("src_eid"),
                field_fixed("sender", 32),
                field_u64("nonce"),
                field_fixed("guid", 32),
                field_vec_u8("message"),
            ],
            map_of(&[
                ("src_eid", sample_u32(*src_eid)),
                ("sender", sample_bytes(sender)),
                ("nonce", sample_u64(*nonce)),
                ("guid", sample_bytes(guid)),
                ("message", sample_bytes(message)),
            ]),
        ),
        GatewayIx::RecoverLockedHome { token_id, to } => (
            "RecoverLockedHome",
            vec![field_fixed("token_id", 32), field_fixed("to", 32)],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("to", sample_bytes(to)),
            ]),
        ),
        GatewayIx::LzReceiveTypes { message } => (
            "LzReceiveTypes",
            vec![field_vec_u8("message")],
            map_of(&[("message", sample_bytes(message))]),
        ),
        GatewayIx::RegisterOApp { delegate } => (
            "RegisterOApp",
            vec![field_fixed("delegate", 32)],
            map_of(&[("delegate", sample_bytes(delegate))]),
        ),
        GatewayIx::SetPeer { remote_eid, peer } => (
            "SetPeer",
            vec![field_u32("remote_eid"), field_fixed("peer", 32)],
            map_of(&[
                ("remote_eid", sample_u32(*remote_eid)),
                ("peer", sample_bytes(peer)),
            ]),
        ),
        GatewayIx::InitLzReceiveTypes => ("InitLzReceiveTypes", vec![], Map::new()),
    };
    entry_from_borsh("kar-gateway", "GatewayIx", name, fields, sample, &ix)
}

// ---- Staking (7) ----

fn staking_entries() -> Vec<ManifestEntry> {
    staking_samples()
        .into_iter()
        .map(layout_and_sample_staking)
        .collect()
}

fn staking_samples() -> Vec<StakingIx> {
    vec![
        StakingIx::Initialize {
            pass_program: b32(0x81),
            min_stake_lamports: 500_000_000,
            min_stake_floor_lamports: 100_000_000,
            unbonding_period_secs: 1_209_600,
        },
        StakingIx::Join {
            amount: 500_000_000,
            category: 3,
            name: "Verifier One".into(),
            metadata_uri: "ar://kar-pro".into(),
        },
        StakingIx::Leave,
        StakingIx::ClaimStake,
        StakingIx::SetVerificationFee { fee: 50_000_000 },
        StakingIx::SetMinStakeNative {
            lamports: 600_000_000,
        },
        StakingIx::ClosePass,
    ]
}

fn layout_and_sample_staking(ix: StakingIx) -> ManifestEntry {
    let (name, fields, sample) = match &ix {
        StakingIx::Initialize {
            pass_program,
            min_stake_lamports,
            min_stake_floor_lamports,
            unbonding_period_secs,
        } => (
            "Initialize",
            vec![
                field_fixed("pass_program", 32),
                field_u64("min_stake_lamports"),
                field_u64("min_stake_floor_lamports"),
                field_u64("unbonding_period_secs"),
            ],
            map_of(&[
                ("pass_program", sample_bytes(pass_program)),
                ("min_stake_lamports", sample_u64(*min_stake_lamports)),
                (
                    "min_stake_floor_lamports",
                    sample_u64(*min_stake_floor_lamports),
                ),
                ("unbonding_period_secs", sample_u64(*unbonding_period_secs)),
            ]),
        ),
        StakingIx::Join {
            amount,
            category,
            name,
            metadata_uri,
        } => (
            "Join",
            vec![
                field_u64("amount"),
                field_u8("category"),
                field_string("name"),
                field_string("metadata_uri"),
            ],
            map_of(&[
                ("amount", sample_u64(*amount)),
                ("category", sample_u8(*category)),
                ("name", sample_string(name)),
                ("metadata_uri", sample_string(metadata_uri)),
            ]),
        ),
        StakingIx::Leave => ("Leave", vec![], Map::new()),
        StakingIx::ClaimStake => ("ClaimStake", vec![], Map::new()),
        StakingIx::SetVerificationFee { fee } => (
            "SetVerificationFee",
            vec![field_u64("fee")],
            map_of(&[("fee", sample_u64(*fee))]),
        ),
        StakingIx::SetMinStakeNative { lamports } => (
            "SetMinStakeNative",
            vec![field_u64("lamports")],
            map_of(&[("lamports", sample_u64(*lamports))]),
        ),
        StakingIx::ClosePass => ("ClosePass", vec![], Map::new()),
    };
    entry_from_borsh("kar-pro-staking", "StakingIx", name, fields, sample, &ix)
}

// ---- Pass (3) ----

fn pass_entries() -> Vec<ManifestEntry> {
    pass_samples()
        .into_iter()
        .map(layout_and_sample_pass)
        .collect()
}

fn pass_samples() -> Vec<PassIx> {
    vec![
        PassIx::Initialize {
            staking_program: b32(0x91),
        },
        PassIx::Mint {
            category: 1,
            name: "Pro".into(),
            metadata_uri: "ar://pass".into(),
        },
        PassIx::ClosePass {
            holder: b32(0x92),
        },
    ]
}

fn layout_and_sample_pass(ix: PassIx) -> ManifestEntry {
    let (name, fields, sample) = match &ix {
        PassIx::Initialize { staking_program } => (
            "Initialize",
            vec![field_fixed("staking_program", 32)],
            map_of(&[("staking_program", sample_bytes(staking_program))]),
        ),
        PassIx::Mint {
            category,
            name,
            metadata_uri,
        } => (
            "Mint",
            vec![
                field_u8("category"),
                field_string("name"),
                field_string("metadata_uri"),
            ],
            map_of(&[
                ("category", sample_u8(*category)),
                ("name", sample_string(name)),
                ("metadata_uri", sample_string(metadata_uri)),
            ]),
        ),
        PassIx::ClosePass { holder } => (
            "ClosePass",
            vec![field_fixed("holder", 32)],
            map_of(&[("holder", sample_bytes(holder))]),
        ),
    };
    entry_from_borsh("kar-pro-pass", "PassIx", name, fields, sample, &ix)
}

// ---- FixedPrice (27) ----

fn fixed_price_entries() -> Vec<ManifestEntry> {
    fixed_price_samples()
        .into_iter()
        .map(layout_and_sample_fixed_price)
        .collect()
}

fn fixed_price_samples() -> Vec<FixedPriceIx> {
    let price_data = [0xb7u8; PRICE_UPDATE_V2_LEN];
    let mut note = [0u8; 256];
    note[..4].copy_from_slice(b"note");
    vec![
        FixedPriceIx::InitConfig {
            platform_fee_bps: 250,
        },
        FixedPriceIx::CreateAsset {
            token_id: b32(0xa1),
        },
        FixedPriceIx::ApproveEscrow {
            token_id: b32(0xa2),
        },
        FixedPriceIx::SetMayOpen {
            token_id: b32(0xa3),
            allowed: true,
        },
        FixedPriceIx::SetSelfEncumbrance { registered: true },
        FixedPriceIx::Grant {
            token_id: b32(0xa4),
            agent: b32(0xa5),
            expiry: 1_700_000_000,
            asset_mint: b32(0xa6),
            denom_kind: 0,
            currency_code: b32(0xa7),
            floor: 1_000_000,
            form: 0,
            commission_bps: 500,
        },
        FixedPriceIx::Revoke {
            token_id: b32(0xa8),
        },
        FixedPriceIx::OpenDirect {
            token_id: b32(0xa9),
            asset_mint: b32(0xaa),
            denom_kind: 0,
            currency_code: b32(0xab),
            price: 2_000_000,
        },
        FixedPriceIx::OpenFromMandate {
            token_id: b32(0xac),
            denom_kind: 1,
            currency_code: b32(0xad),
            price: 3_000_000,
        },
        FixedPriceIx::SetPrice {
            token_id: b32(0xae),
            new_price: 4_000_000,
        },
        FixedPriceIx::LowerFloor {
            token_id: b32(0xaf),
            new_floor: 900_000,
        },
        FixedPriceIx::LowerCommission {
            token_id: b32(0xb0),
            new_bps: 400,
        },
        FixedPriceIx::RequestRecall {
            token_id: b32(0xb1),
        },
        FixedPriceIx::ForceRecall {
            token_id: b32(0xb2),
        },
        FixedPriceIx::OwnerWithdraw {
            token_id: b32(0xb3),
        },
        FixedPriceIx::AgentWithdraw {
            token_id: b32(0xb4),
        },
        FixedPriceIx::EnterCommitted {
            token_id: b32(0xb5),
        },
        FixedPriceIx::Pause,
        FixedPriceIx::Unpause,
        FixedPriceIx::ApprovePaymentToken {
            price_program: b32(0xb6),
            feed_id: b32(0xb8),
            staleness_tolerance: 120,
            max_confidence_bps: 100,
        },
        FixedPriceIx::RevokePaymentToken {
            mint: b32(0xb9),
        },
        FixedPriceIx::Buy {
            token_id: b32(0xba),
        },
        FixedPriceIx::SetSettlementNote {
            token_id: b32(0xbb),
            note,
            note_len: 4,
        },
        FixedPriceIx::ConfirmExternalPayment {
            token_id: b32(0xbc),
            buyer: b32(0xbd),
        },
        FixedPriceIx::WithdrawClaim,
        FixedPriceIx::ForceRecallRequestedAt {
            token_id: b32(0xbe),
            requested_at: 1_700_000_100,
        },
        FixedPriceIx::ForceSeedPriceAccount {
            feed_id: b32(0xbf),
            data: price_data,
        },
    ]
}

fn layout_and_sample_fixed_price(ix: FixedPriceIx) -> ManifestEntry {
    let (name, fields, sample) = match &ix {
        FixedPriceIx::InitConfig { platform_fee_bps } => (
            "InitConfig",
            vec![field_u16("platform_fee_bps")],
            map_of(&[("platform_fee_bps", sample_u16(*platform_fee_bps))]),
        ),
        FixedPriceIx::CreateAsset { token_id } => (
            "CreateAsset",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        FixedPriceIx::ApproveEscrow { token_id } => (
            "ApproveEscrow",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        FixedPriceIx::SetMayOpen { token_id, allowed } => (
            "SetMayOpen",
            vec![field_fixed("token_id", 32), field_bool("allowed")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("allowed", sample_bool(*allowed)),
            ]),
        ),
        FixedPriceIx::SetSelfEncumbrance { registered } => (
            "SetSelfEncumbrance",
            vec![field_bool("registered")],
            map_of(&[("registered", sample_bool(*registered))]),
        ),
        FixedPriceIx::Grant {
            token_id,
            agent,
            expiry,
            asset_mint,
            denom_kind,
            currency_code,
            floor,
            form,
            commission_bps,
        } => (
            "Grant",
            vec![
                field_fixed("token_id", 32),
                field_fixed("agent", 32),
                field_u64("expiry"),
                field_fixed("asset_mint", 32),
                field_u8("denom_kind"),
                field_fixed("currency_code", 32),
                field_u64("floor"),
                field_u8("form"),
                field_u16("commission_bps"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("agent", sample_bytes(agent)),
                ("expiry", sample_u64(*expiry)),
                ("asset_mint", sample_bytes(asset_mint)),
                ("denom_kind", sample_u8(*denom_kind)),
                ("currency_code", sample_bytes(currency_code)),
                ("floor", sample_u64(*floor)),
                ("form", sample_u8(*form)),
                ("commission_bps", sample_u16(*commission_bps)),
            ]),
        ),
        FixedPriceIx::Revoke { token_id } => (
            "Revoke",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        FixedPriceIx::OpenDirect {
            token_id,
            asset_mint,
            denom_kind,
            currency_code,
            price,
        } => (
            "OpenDirect",
            vec![
                field_fixed("token_id", 32),
                field_fixed("asset_mint", 32),
                field_u8("denom_kind"),
                field_fixed("currency_code", 32),
                field_u64("price"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("asset_mint", sample_bytes(asset_mint)),
                ("denom_kind", sample_u8(*denom_kind)),
                ("currency_code", sample_bytes(currency_code)),
                ("price", sample_u64(*price)),
            ]),
        ),
        FixedPriceIx::OpenFromMandate {
            token_id,
            denom_kind,
            currency_code,
            price,
        } => (
            "OpenFromMandate",
            vec![
                field_fixed("token_id", 32),
                field_u8("denom_kind"),
                field_fixed("currency_code", 32),
                field_u64("price"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("denom_kind", sample_u8(*denom_kind)),
                ("currency_code", sample_bytes(currency_code)),
                ("price", sample_u64(*price)),
            ]),
        ),
        FixedPriceIx::SetPrice { token_id, new_price } => (
            "SetPrice",
            vec![field_fixed("token_id", 32), field_u64("new_price")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("new_price", sample_u64(*new_price)),
            ]),
        ),
        FixedPriceIx::LowerFloor { token_id, new_floor } => (
            "LowerFloor",
            vec![field_fixed("token_id", 32), field_u64("new_floor")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("new_floor", sample_u64(*new_floor)),
            ]),
        ),
        FixedPriceIx::LowerCommission { token_id, new_bps } => (
            "LowerCommission",
            vec![field_fixed("token_id", 32), field_u16("new_bps")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("new_bps", sample_u16(*new_bps)),
            ]),
        ),
        FixedPriceIx::RequestRecall { token_id } => (
            "RequestRecall",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        FixedPriceIx::ForceRecall { token_id } => (
            "ForceRecall",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        FixedPriceIx::OwnerWithdraw { token_id } => (
            "OwnerWithdraw",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        FixedPriceIx::AgentWithdraw { token_id } => (
            "AgentWithdraw",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        FixedPriceIx::EnterCommitted { token_id } => (
            "EnterCommitted",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        FixedPriceIx::Pause => ("Pause", vec![], Map::new()),
        FixedPriceIx::Unpause => ("Unpause", vec![], Map::new()),
        FixedPriceIx::ApprovePaymentToken {
            price_program,
            feed_id,
            staleness_tolerance,
            max_confidence_bps,
        } => (
            "ApprovePaymentToken",
            vec![
                field_fixed("price_program", 32),
                field_fixed("feed_id", 32),
                field_u32("staleness_tolerance"),
                field_u32("max_confidence_bps"),
            ],
            map_of(&[
                ("price_program", sample_bytes(price_program)),
                ("feed_id", sample_bytes(feed_id)),
                ("staleness_tolerance", sample_u32(*staleness_tolerance)),
                ("max_confidence_bps", sample_u32(*max_confidence_bps)),
            ]),
        ),
        FixedPriceIx::RevokePaymentToken { mint } => (
            "RevokePaymentToken",
            vec![field_fixed("mint", 32)],
            map_of(&[("mint", sample_bytes(mint))]),
        ),
        FixedPriceIx::Buy { token_id } => (
            "Buy",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        FixedPriceIx::SetSettlementNote {
            token_id,
            note,
            note_len,
        } => (
            "SetSettlementNote",
            vec![
                field_fixed("token_id", 32),
                field_fixed("note", 256),
                field_u32("note_len"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("note", sample_bytes(note)),
                ("note_len", sample_u32(*note_len)),
            ]),
        ),
        FixedPriceIx::ConfirmExternalPayment { token_id, buyer } => (
            "ConfirmExternalPayment",
            vec![field_fixed("token_id", 32), field_fixed("buyer", 32)],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("buyer", sample_bytes(buyer)),
            ]),
        ),
        FixedPriceIx::WithdrawClaim => ("WithdrawClaim", vec![], Map::new()),
        FixedPriceIx::ForceRecallRequestedAt {
            token_id,
            requested_at,
        } => (
            "ForceRecallRequestedAt",
            vec![field_fixed("token_id", 32), field_u64("requested_at")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("requested_at", sample_u64(*requested_at)),
            ]),
        ),
        FixedPriceIx::ForceSeedPriceAccount { feed_id, data } => (
            "ForceSeedPriceAccount",
            vec![
                field_fixed("feed_id", 32),
                field_fixed("data", PRICE_UPDATE_V2_LEN),
            ],
            map_of(&[
                ("feed_id", sample_bytes(feed_id)),
                ("data", sample_bytes(data)),
            ]),
        ),
    };
    entry_from_borsh("kar-fixed-price", "FixedPriceIx", name, fields, sample, &ix)
}

// ---- Ascending (32) ----

fn ascending_entries() -> Vec<ManifestEntry> {
    ascending_samples()
        .into_iter()
        .map(layout_and_sample_ascending)
        .collect()
}

fn ascending_samples() -> Vec<AscendingIx> {
    vec![
        AscendingIx::InitConfig {
            platform_fee_bps: 250,
            challenge_bond: 100_000_000,
            challenge_window: 1_209_600,
            staking_program: b32(0xc1),
        },
        AscendingIx::CreateAsset {
            token_id: b32(0xc2),
        },
        AscendingIx::ApproveEscrow {
            token_id: b32(0xc3),
        },
        AscendingIx::SetMayOpen {
            token_id: b32(0xc4),
            allowed: false,
        },
        AscendingIx::SetVerified {
            token_id: b32(0xc5),
            verified: true,
        },
        AscendingIx::SetSelfEncumbrance { registered: false },
        AscendingIx::Grant {
            token_id: b32(0xc6),
            agent: b32(0xc7),
            expiry: 1_800_000_000,
            asset_mint: b32(0xc8),
            denom_kind: 0,
            currency_code: b32(0xc9),
            floor: 5_000_000,
            form: 1,
            commission_bps: 300,
        },
        AscendingIx::Revoke {
            token_id: b32(0xca),
        },
        AscendingIx::OpenDirect {
            token_id: b32(0xcb),
            asset_mint: b32(0xcc),
            denom_kind: 0,
            currency_code: b32(0xcd),
            price: 6_000_000,
        },
        AscendingIx::OpenFromMandate {
            token_id: b32(0xce),
            denom_kind: 0,
            currency_code: b32(0xcf),
            price: 7_000_000,
        },
        AscendingIx::SetPrice {
            token_id: b32(0xd0),
            new_price: 8_000_000,
        },
        AscendingIx::OpenAscendingDirect {
            token_id: b32(0xd1),
            asset_mint: b32(0xd2),
            reserve: 1_000_000,
            duration: 259_200,
            protection_window: 604_800,
        },
        AscendingIx::OpenAscendingFromMandate {
            token_id: b32(0xd3),
            reserve: 1_100_000,
            duration: 345_600,
            protection_window: 1_209_600,
        },
        AscendingIx::Bid {
            token_id: b32(0xd4),
            amount: 2_000_000,
        },
        AscendingIx::Settle {
            token_id: b32(0xd5),
        },
        AscendingIx::ConfirmReceipt {
            token_id: b32(0xd6),
        },
        AscendingIx::ReleaseFunds {
            token_id: b32(0xd7),
        },
        AscendingIx::CompleteReversal {
            token_id: b32(0xd8),
        },
        AscendingIx::AbandonReversal {
            token_id: b32(0xd9),
        },
        AscendingIx::OpenChallenge {
            token_id: b32(0xda),
        },
        AscendingIx::WithdrawChallenge {
            token_id: b32(0xdb),
        },
        AscendingIx::JudgeChallenge {
            token_id: b32(0xdc),
            outcome: 1,
        },
        AscendingIx::ConcludeChallenge {
            token_id: b32(0xdd),
        },
        AscendingIx::ApprovePaymentToken,
        AscendingIx::RevokePaymentToken {
            mint: b32(0xde),
        },
        AscendingIx::Pause,
        AscendingIx::Unpause,
        AscendingIx::SetChallengeBond {
            challenge_bond: 150_000_000,
        },
        AscendingIx::WithdrawClaim,
        AscendingIx::ForceAuctionEndsAt {
            token_id: b32(0xdf),
            ends_at: 1_900_000_000,
        },
        AscendingIx::ForceHoldClock {
            token_id: b32(0xe0),
            protection_ends_at: 1_900_000_100,
            frozen_remaining: 50_000,
            abandonment_deadline: 1_900_100_000,
        },
        AscendingIx::ForceAssetOwner {
            token_id: b32(0xe1),
            owner: b32(0xe2),
        },
    ]
}

fn layout_and_sample_ascending(ix: AscendingIx) -> ManifestEntry {
    let (name, fields, sample) = match &ix {
        AscendingIx::InitConfig {
            platform_fee_bps,
            challenge_bond,
            challenge_window,
            staking_program,
        } => (
            "InitConfig",
            vec![
                field_u16("platform_fee_bps"),
                field_u64("challenge_bond"),
                field_u64("challenge_window"),
                field_fixed("staking_program", 32),
            ],
            map_of(&[
                ("platform_fee_bps", sample_u16(*platform_fee_bps)),
                ("challenge_bond", sample_u64(*challenge_bond)),
                ("challenge_window", sample_u64(*challenge_window)),
                ("staking_program", sample_bytes(staking_program)),
            ]),
        ),
        AscendingIx::CreateAsset { token_id } => (
            "CreateAsset",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        AscendingIx::ApproveEscrow { token_id } => (
            "ApproveEscrow",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        AscendingIx::SetMayOpen { token_id, allowed } => (
            "SetMayOpen",
            vec![field_fixed("token_id", 32), field_bool("allowed")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("allowed", sample_bool(*allowed)),
            ]),
        ),
        AscendingIx::SetVerified { token_id, verified } => (
            "SetVerified",
            vec![field_fixed("token_id", 32), field_bool("verified")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("verified", sample_bool(*verified)),
            ]),
        ),
        AscendingIx::SetSelfEncumbrance { registered } => (
            "SetSelfEncumbrance",
            vec![field_bool("registered")],
            map_of(&[("registered", sample_bool(*registered))]),
        ),
        AscendingIx::Grant {
            token_id,
            agent,
            expiry,
            asset_mint,
            denom_kind,
            currency_code,
            floor,
            form,
            commission_bps,
        } => (
            "Grant",
            vec![
                field_fixed("token_id", 32),
                field_fixed("agent", 32),
                field_u64("expiry"),
                field_fixed("asset_mint", 32),
                field_u8("denom_kind"),
                field_fixed("currency_code", 32),
                field_u64("floor"),
                field_u8("form"),
                field_u16("commission_bps"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("agent", sample_bytes(agent)),
                ("expiry", sample_u64(*expiry)),
                ("asset_mint", sample_bytes(asset_mint)),
                ("denom_kind", sample_u8(*denom_kind)),
                ("currency_code", sample_bytes(currency_code)),
                ("floor", sample_u64(*floor)),
                ("form", sample_u8(*form)),
                ("commission_bps", sample_u16(*commission_bps)),
            ]),
        ),
        AscendingIx::Revoke { token_id } => (
            "Revoke",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        AscendingIx::OpenDirect {
            token_id,
            asset_mint,
            denom_kind,
            currency_code,
            price,
        } => (
            "OpenDirect",
            vec![
                field_fixed("token_id", 32),
                field_fixed("asset_mint", 32),
                field_u8("denom_kind"),
                field_fixed("currency_code", 32),
                field_u64("price"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("asset_mint", sample_bytes(asset_mint)),
                ("denom_kind", sample_u8(*denom_kind)),
                ("currency_code", sample_bytes(currency_code)),
                ("price", sample_u64(*price)),
            ]),
        ),
        AscendingIx::OpenFromMandate {
            token_id,
            denom_kind,
            currency_code,
            price,
        } => (
            "OpenFromMandate",
            vec![
                field_fixed("token_id", 32),
                field_u8("denom_kind"),
                field_fixed("currency_code", 32),
                field_u64("price"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("denom_kind", sample_u8(*denom_kind)),
                ("currency_code", sample_bytes(currency_code)),
                ("price", sample_u64(*price)),
            ]),
        ),
        AscendingIx::SetPrice { token_id, new_price } => (
            "SetPrice",
            vec![field_fixed("token_id", 32), field_u64("new_price")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("new_price", sample_u64(*new_price)),
            ]),
        ),
        AscendingIx::OpenAscendingDirect {
            token_id,
            asset_mint,
            reserve,
            duration,
            protection_window,
        } => (
            "OpenAscendingDirect",
            vec![
                field_fixed("token_id", 32),
                field_fixed("asset_mint", 32),
                field_u64("reserve"),
                field_u64("duration"),
                field_u64("protection_window"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("asset_mint", sample_bytes(asset_mint)),
                ("reserve", sample_u64(*reserve)),
                ("duration", sample_u64(*duration)),
                ("protection_window", sample_u64(*protection_window)),
            ]),
        ),
        AscendingIx::OpenAscendingFromMandate {
            token_id,
            reserve,
            duration,
            protection_window,
        } => (
            "OpenAscendingFromMandate",
            vec![
                field_fixed("token_id", 32),
                field_u64("reserve"),
                field_u64("duration"),
                field_u64("protection_window"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("reserve", sample_u64(*reserve)),
                ("duration", sample_u64(*duration)),
                ("protection_window", sample_u64(*protection_window)),
            ]),
        ),
        AscendingIx::Bid { token_id, amount } => (
            "Bid",
            vec![field_fixed("token_id", 32), field_u64("amount")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("amount", sample_u64(*amount)),
            ]),
        ),
        AscendingIx::Settle { token_id } => (
            "Settle",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        AscendingIx::ConfirmReceipt { token_id } => (
            "ConfirmReceipt",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        AscendingIx::ReleaseFunds { token_id } => (
            "ReleaseFunds",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        AscendingIx::CompleteReversal { token_id } => (
            "CompleteReversal",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        AscendingIx::AbandonReversal { token_id } => (
            "AbandonReversal",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        AscendingIx::OpenChallenge { token_id } => (
            "OpenChallenge",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        AscendingIx::WithdrawChallenge { token_id } => (
            "WithdrawChallenge",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        AscendingIx::JudgeChallenge { token_id, outcome } => (
            "JudgeChallenge",
            vec![field_fixed("token_id", 32), field_u8("outcome")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("outcome", sample_u8(*outcome)),
            ]),
        ),
        AscendingIx::ConcludeChallenge { token_id } => (
            "ConcludeChallenge",
            vec![field_fixed("token_id", 32)],
            map_of(&[("token_id", sample_bytes(token_id))]),
        ),
        AscendingIx::ApprovePaymentToken => ("ApprovePaymentToken", vec![], Map::new()),
        AscendingIx::RevokePaymentToken { mint } => (
            "RevokePaymentToken",
            vec![field_fixed("mint", 32)],
            map_of(&[("mint", sample_bytes(mint))]),
        ),
        AscendingIx::Pause => ("Pause", vec![], Map::new()),
        AscendingIx::Unpause => ("Unpause", vec![], Map::new()),
        AscendingIx::SetChallengeBond { challenge_bond } => (
            "SetChallengeBond",
            vec![field_u64("challenge_bond")],
            map_of(&[("challenge_bond", sample_u64(*challenge_bond))]),
        ),
        AscendingIx::WithdrawClaim => ("WithdrawClaim", vec![], Map::new()),
        AscendingIx::ForceAuctionEndsAt { token_id, ends_at } => (
            "ForceAuctionEndsAt",
            vec![field_fixed("token_id", 32), field_u64("ends_at")],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("ends_at", sample_u64(*ends_at)),
            ]),
        ),
        AscendingIx::ForceHoldClock {
            token_id,
            protection_ends_at,
            frozen_remaining,
            abandonment_deadline,
        } => (
            "ForceHoldClock",
            vec![
                field_fixed("token_id", 32),
                field_u64("protection_ends_at"),
                field_u64("frozen_remaining"),
                field_u64("abandonment_deadline"),
            ],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("protection_ends_at", sample_u64(*protection_ends_at)),
                ("frozen_remaining", sample_u64(*frozen_remaining)),
                ("abandonment_deadline", sample_u64(*abandonment_deadline)),
            ]),
        ),
        AscendingIx::ForceAssetOwner { token_id, owner } => (
            "ForceAssetOwner",
            vec![field_fixed("token_id", 32), field_fixed("owner", 32)],
            map_of(&[
                ("token_id", sample_bytes(token_id)),
                ("owner", sample_bytes(owner)),
            ]),
        ),
    };
    entry_from_borsh("kar-ascending", "AscendingIx", name, fields, sample, &ix)
}
