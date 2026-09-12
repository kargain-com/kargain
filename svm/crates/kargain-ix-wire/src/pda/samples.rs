//! Exhaustive PDA recipe samples.
//!
//! `entry_for` matches have **no** wildcard arm: adding a `PdaRecipe` variant
//! without a sample arm fails to compile. Goldens come only from the real
//! `*_pda` helpers' `find_program_address` calls against the synthetic program id.

use serde_json::{Map, Value};
use solana_program::pubkey::Pubkey;

use super::{
    dynamic_bytes32, dynamic_u32_be, dynamic_u32_le, PdaDynamicDecl, PdaManifestRecipe,
    SYNTHETIC_PDA_PROGRAM_ID_BYTES,
};
use crate::{hex_of, sample_bytes, sample_u32};

/// Closed census of product PDA recipes (floor 30).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdaRecipe {
    KarPassportConfig,
    KarPassportAsset,
    KarPassportState,
    KarPassportRecord,
    KarGatewayConfig,
    KarGatewayFreeze,
    KarGatewayPeer,
    KarGatewayLzReceiveTypes,
    KarProStakingConfig,
    KarProStakingStake,
    KarProPassConfig,
    KarProPassFreeze,
    KarProPassPassAsset,
    KarProPassPassMeta,
    KarFixedPricePaymentToken,
    KarFixedPriceNote,
    KarFixedPricePriceLab,
    KarAscendingAuction,
    KarAscendingHold,
    KarAscendingPaymentToken,
    ConsignmentBaseConfig,
    ConsignmentBaseConsignment,
    ConsignmentBaseMandate,
    ConsignmentBaseRecall,
    ConsignmentBaseAsset,
    ConsignmentBaseCustodyAuthority,
    ClaimablePayoutsClaim,
    ClaimablePayoutsClaimAta,
    ClaimablePayoutsEscrow,
    BondedChallengeChallenge,
}

/// Every recipe, in stable owner/name order. Length is the census floor.
pub fn all_recipes() -> [PdaRecipe; 30] {
    use PdaRecipe::*;
    [
        KarPassportConfig,
        KarPassportAsset,
        KarPassportState,
        KarPassportRecord,
        KarGatewayConfig,
        KarGatewayFreeze,
        KarGatewayPeer,
        KarGatewayLzReceiveTypes,
        KarProStakingConfig,
        KarProStakingStake,
        KarProPassConfig,
        KarProPassFreeze,
        KarProPassPassAsset,
        KarProPassPassMeta,
        KarFixedPricePaymentToken,
        KarFixedPriceNote,
        KarFixedPricePriceLab,
        KarAscendingAuction,
        KarAscendingHold,
        KarAscendingPaymentToken,
        ConsignmentBaseConfig,
        ConsignmentBaseConsignment,
        ConsignmentBaseMandate,
        ConsignmentBaseRecall,
        ConsignmentBaseAsset,
        ConsignmentBaseCustodyAuthority,
        ClaimablePayoutsClaim,
        ClaimablePayoutsClaimAta,
        ClaimablePayoutsEscrow,
        BondedChallengeChallenge,
    ]
}

pub fn all_pda_recipes() -> Vec<PdaManifestRecipe> {
    all_recipes().into_iter().map(entry_for).collect()
}

fn synthetic_program() -> Pubkey {
    Pubkey::new_from_array(SYNTHETIC_PDA_PROGRAM_ID_BYTES)
}

fn map_of(pairs: &[(&str, Value)]) -> Map<String, Value> {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert((*k).into(), v.clone());
    }
    m
}

fn recipe(
    owner: &str,
    name: &str,
    seed_tag: &[u8],
    dynamics: Vec<PdaDynamicDecl>,
    sample: Map<String, Value>,
    address: Pubkey,
    bump: u8,
) -> PdaManifestRecipe {
    PdaManifestRecipe {
        owner: owner.into(),
        id: format!("{owner}/{name}"),
        seed_tag_hex: hex_of(seed_tag),
        dynamics,
        sample,
        golden_address: address.to_string(),
        golden_bump: bump,
    }
}

/// Deterministic sample bytes (never live keys).
fn sample_token_id() -> [u8; 32] {
    [0xaa; 32]
}
fn sample_mint() -> [u8; 32] {
    [0xbb; 32]
}
fn sample_holder() -> [u8; 32] {
    [0xcc; 32]
}
fn sample_verifier() -> [u8; 32] {
    [0xdd; 32]
}
fn sample_feed_id() -> [u8; 32] {
    [0xee; 32]
}
fn sample_recipient() -> [u8; 32] {
    [0x01; 32]
}
fn sample_claim_mint() -> [u8; 32] {
    [0x02; 32]
}
fn sample_gateway_config() -> [u8; 32] {
    [0x03; 32]
}
fn sample_oapp() -> [u8; 32] {
    [0x04; 32]
}
fn sample_subject() -> [u8; 32] {
    [0x05; 32]
}
fn sample_consignment_id() -> [u8; 32] {
    [0x06; 32]
}
const SAMPLE_RECORD_INDEX: u32 = 7;
const SAMPLE_REMOTE_EID: u32 = 40_245;

fn entry_for(r: PdaRecipe) -> PdaManifestRecipe {
    let program = synthetic_program();
    match r {
        PdaRecipe::KarPassportConfig => {
            let (addr, bump) = kar_passport::seeds::config_pda(&program);
            recipe(
                "kar-passport",
                "config",
                kar_passport::seeds::CONFIG_SEED,
                vec![],
                Map::new(),
                addr,
                bump,
            )
        }
        PdaRecipe::KarPassportAsset => {
            let tid = sample_token_id();
            let (addr, bump) = kar_passport::seeds::asset_pda(&program, &tid);
            recipe(
                "kar-passport",
                "asset",
                kar_passport::seeds::ASSET_SEED,
                vec![dynamic_bytes32("token_id")],
                map_of(&[("token_id", sample_bytes(&tid))]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarPassportState => {
            let tid = sample_token_id();
            let (addr, bump) = kar_passport::seeds::state_pda(&program, &tid);
            recipe(
                "kar-passport",
                "state",
                kar_passport::seeds::STATE_SEED,
                vec![dynamic_bytes32("token_id")],
                map_of(&[("token_id", sample_bytes(&tid))]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarPassportRecord => {
            let tid = sample_token_id();
            let (addr, bump) =
                kar_passport::seeds::record_pda(&program, &tid, SAMPLE_RECORD_INDEX);
            recipe(
                "kar-passport",
                "record",
                kar_passport::seeds::RECORD_SEED,
                vec![
                    dynamic_bytes32("token_id"),
                    dynamic_u32_le("index"),
                ],
                map_of(&[
                    ("token_id", sample_bytes(&tid)),
                    ("index", sample_u32(SAMPLE_RECORD_INDEX)),
                ]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarGatewayConfig => {
            let (addr, bump) = kar_gateway::seeds::config_pda(&program);
            recipe(
                "kar-gateway",
                "config",
                kar_gateway::seeds::CONFIG_SEED,
                vec![],
                Map::new(),
                addr,
                bump,
            )
        }
        PdaRecipe::KarGatewayFreeze => {
            let (addr, bump) = kar_gateway::seeds::freeze_pda(&program);
            recipe(
                "kar-gateway",
                "freeze",
                kar_gateway::seeds::FREEZE_SEED,
                vec![],
                Map::new(),
                addr,
                bump,
            )
        }
        PdaRecipe::KarGatewayPeer => {
            let gw = Pubkey::new_from_array(sample_gateway_config());
            let (addr, bump) =
                kar_gateway::peer::peer_pda(&program, &gw, SAMPLE_REMOTE_EID);
            recipe(
                "kar-gateway",
                "peer",
                kar_gateway::seeds::PEER_SEED,
                vec![
                    dynamic_bytes32("gateway_config"),
                    dynamic_u32_be("remote_eid"),
                ],
                map_of(&[
                    ("gateway_config", sample_bytes(gw.as_ref())),
                    ("remote_eid", sample_u32(SAMPLE_REMOTE_EID)),
                ]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarGatewayLzReceiveTypes => {
            let oapp = Pubkey::new_from_array(sample_oapp());
            let (addr, bump) =
                kar_gateway::lz_receive_v2::lz_receive_types_pda(&program, &oapp);
            recipe(
                "kar-gateway",
                "lz_receive_types",
                kar_gateway::lz_receive_v2::LZ_RECEIVE_TYPES_SEED,
                vec![dynamic_bytes32("oapp")],
                map_of(&[("oapp", sample_bytes(oapp.as_ref()))]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarProStakingConfig => {
            let (addr, bump) = kar_pro_staking::seeds::config_pda(&program);
            recipe(
                "kar-pro-staking",
                "config",
                kar_pro_staking::seeds::CONFIG_SEED,
                vec![],
                Map::new(),
                addr,
                bump,
            )
        }
        PdaRecipe::KarProStakingStake => {
            let v = sample_verifier();
            let (addr, bump) = kar_pro_staking::seeds::stake_pda(&program, &v);
            recipe(
                "kar-pro-staking",
                "stake",
                kar_pro_staking::seeds::STAKE_SEED,
                vec![dynamic_bytes32("verifier")],
                map_of(&[("verifier", sample_bytes(&v))]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarProPassConfig => {
            let (addr, bump) = kar_pro_pass::seeds::config_pda(&program);
            recipe(
                "kar-pro-pass",
                "config",
                kar_pro_pass::seeds::CONFIG_SEED,
                vec![],
                Map::new(),
                addr,
                bump,
            )
        }
        PdaRecipe::KarProPassFreeze => {
            let (addr, bump) = kar_pro_pass::seeds::freeze_pda(&program);
            recipe(
                "kar-pro-pass",
                "freeze",
                kar_pro_pass::seeds::FREEZE_SEED,
                vec![],
                Map::new(),
                addr,
                bump,
            )
        }
        PdaRecipe::KarProPassPassAsset => {
            let h = sample_holder();
            let (addr, bump) = kar_pro_pass::seeds::pass_asset_pda(&program, &h);
            recipe(
                "kar-pro-pass",
                "pass_asset",
                kar_pro_pass::seeds::PASS_SEED,
                vec![dynamic_bytes32("holder")],
                map_of(&[("holder", sample_bytes(&h))]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarProPassPassMeta => {
            let h = sample_holder();
            let (addr, bump) = kar_pro_pass::seeds::pass_meta_pda(&program, &h);
            recipe(
                "kar-pro-pass",
                "pass_meta",
                kar_pro_pass::seeds::PASS_META_SEED,
                vec![dynamic_bytes32("holder")],
                map_of(&[("holder", sample_bytes(&h))]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarFixedPricePaymentToken => {
            let mint = sample_mint();
            let (addr, bump) = kar_fixed_price::ix::payment_token_pda(&program, &mint);
            recipe(
                "kar-fixed-price",
                "payment_token",
                kar_fixed_price::ix::PAYMENT_TOKEN_SEED,
                vec![dynamic_bytes32("mint")],
                map_of(&[("mint", sample_bytes(&mint))]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarFixedPriceNote => {
            let tid = sample_token_id();
            let (addr, bump) = kar_fixed_price::ix::note_pda(&program, &tid);
            recipe(
                "kar-fixed-price",
                "note",
                kar_fixed_price::ix::NOTE_SEED,
                vec![dynamic_bytes32("token_id")],
                map_of(&[("token_id", sample_bytes(&tid))]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarFixedPricePriceLab => {
            let feed = sample_feed_id();
            let (addr, bump) = kar_fixed_price::ix::price_lab_pda(&program, &feed);
            recipe(
                "kar-fixed-price",
                "price_lab",
                kar_fixed_price::ix::PRICE_LAB_SEED,
                vec![dynamic_bytes32("feed_id")],
                map_of(&[("feed_id", sample_bytes(&feed))]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarAscendingAuction => {
            let tid = sample_token_id();
            let (addr, bump) = kar_ascending::ix::auction_pda(&program, &tid);
            recipe(
                "kar-ascending",
                "auction",
                kar_ascending::ix::AUCTION_SEED,
                vec![dynamic_bytes32("token_id")],
                map_of(&[("token_id", sample_bytes(&tid))]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarAscendingHold => {
            let tid = sample_token_id();
            let (addr, bump) = kar_ascending::ix::hold_pda(&program, &tid);
            recipe(
                "kar-ascending",
                "hold",
                kar_ascending::ix::HOLD_SEED,
                vec![dynamic_bytes32("token_id")],
                map_of(&[("token_id", sample_bytes(&tid))]),
                addr,
                bump,
            )
        }
        PdaRecipe::KarAscendingPaymentToken => {
            let mint = sample_mint();
            let (addr, bump) = kar_ascending::ix::payment_token_pda(&program, &mint);
            recipe(
                "kar-ascending",
                "payment_token",
                kar_ascending::ix::PAYMENT_TOKEN_SEED,
                vec![dynamic_bytes32("mint")],
                map_of(&[("mint", sample_bytes(&mint))]),
                addr,
                bump,
            )
        }
        PdaRecipe::ConsignmentBaseConfig => {
            let (addr, bump) = kargain_consignment_base::config_pda(&program);
            recipe(
                "kargain-consignment-base",
                "config",
                kargain_consignment_base::CONFIG_SEED,
                vec![],
                Map::new(),
                addr,
                bump,
            )
        }
        PdaRecipe::ConsignmentBaseConsignment => {
            let tid = sample_token_id();
            let (addr, bump) = kargain_consignment_base::consignment_pda(&program, &tid);
            recipe(
                "kargain-consignment-base",
                "consignment",
                kargain_consignment_base::CONSIGNMENT_SEED,
                vec![dynamic_bytes32("token_id")],
                map_of(&[("token_id", sample_bytes(&tid))]),
                addr,
                bump,
            )
        }
        PdaRecipe::ConsignmentBaseMandate => {
            let tid = sample_token_id();
            let (addr, bump) = kargain_consignment_base::mandate_pda(&program, &tid);
            recipe(
                "kargain-consignment-base",
                "mandate",
                kargain_consignment_base::MANDATE_SEED,
                vec![dynamic_bytes32("token_id")],
                map_of(&[("token_id", sample_bytes(&tid))]),
                addr,
                bump,
            )
        }
        PdaRecipe::ConsignmentBaseRecall => {
            let tid = sample_token_id();
            let (addr, bump) = kargain_consignment_base::recall_pda(&program, &tid);
            recipe(
                "kargain-consignment-base",
                "recall",
                kargain_consignment_base::RECALL_SEED,
                vec![dynamic_bytes32("token_id")],
                map_of(&[("token_id", sample_bytes(&tid))]),
                addr,
                bump,
            )
        }
        PdaRecipe::ConsignmentBaseAsset => {
            let tid = sample_token_id();
            let (addr, bump) = kargain_consignment_base::asset_pda(&program, &tid);
            recipe(
                "kargain-consignment-base",
                "asset",
                kargain_consignment_base::ASSET_SEED,
                vec![dynamic_bytes32("token_id")],
                map_of(&[("token_id", sample_bytes(&tid))]),
                addr,
                bump,
            )
        }
        PdaRecipe::ConsignmentBaseCustodyAuthority => {
            let (addr, bump) = kargain_consignment_base::custody_authority_pda(&program);
            recipe(
                "kargain-consignment-base",
                "custody_authority",
                kargain_consignment_base::CUSTODY_SEED,
                vec![],
                Map::new(),
                addr,
                bump,
            )
        }
        PdaRecipe::ClaimablePayoutsClaim => {
            let recipient = Pubkey::new_from_array(sample_recipient());
            let mint = Pubkey::new_from_array(sample_claim_mint());
            let (addr, bump) =
                kargain_claimable_payouts::claim_pda(&program, &recipient, &mint);
            recipe(
                "kargain-claimable-payouts",
                "claim",
                kargain_claimable_payouts::CLAIM_SEED,
                vec![
                    dynamic_bytes32("recipient"),
                    dynamic_bytes32("mint"),
                ],
                map_of(&[
                    ("recipient", sample_bytes(recipient.as_ref())),
                    ("mint", sample_bytes(mint.as_ref())),
                ]),
                addr,
                bump,
            )
        }
        PdaRecipe::ClaimablePayoutsClaimAta => {
            let recipient = Pubkey::new_from_array(sample_recipient());
            let mint = Pubkey::new_from_array(sample_claim_mint());
            let (addr, bump) =
                kargain_claimable_payouts::claim_ata_pda(&program, &recipient, &mint);
            recipe(
                "kargain-claimable-payouts",
                "claim_ata",
                kargain_claimable_payouts::CLAIM_ATA_SEED,
                vec![
                    dynamic_bytes32("recipient"),
                    dynamic_bytes32("mint"),
                ],
                map_of(&[
                    ("recipient", sample_bytes(recipient.as_ref())),
                    ("mint", sample_bytes(mint.as_ref())),
                ]),
                addr,
                bump,
            )
        }
        PdaRecipe::ClaimablePayoutsEscrow => {
            let cid = sample_consignment_id();
            let (addr, bump) = kargain_claimable_payouts::escrow_pda(&program, &cid);
            recipe(
                "kargain-claimable-payouts",
                "escrow",
                kargain_claimable_payouts::ESCROW_SEED,
                vec![dynamic_bytes32("consignment_id")],
                map_of(&[("consignment_id", sample_bytes(&cid))]),
                addr,
                bump,
            )
        }
        PdaRecipe::BondedChallengeChallenge => {
            let subject = sample_subject();
            let (addr, bump) =
                kargain_bonded_challenge::challenge_pda(&program, &subject);
            recipe(
                "kargain-bonded-challenge",
                "challenge",
                kargain_bonded_challenge::CHALLENGE_SEED,
                vec![dynamic_bytes32("subject_id")],
                map_of(&[("subject_id", sample_bytes(&subject))]),
                addr,
                bump,
            )
        }
    }
}
