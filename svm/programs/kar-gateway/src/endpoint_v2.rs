//! LayerZero EndpointV2 (Solana) — production clear CPI + PDA seeds.
//!
//! Pin: LayerZero-v2 `9c741e7f9790639537b1710a203bcdfd73b0b9ac` (RESULTS.md S4a-1).
//! Seeds and `get_accounts_for_clear` order must stay identical to that commit.

use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Runtime production Endpoint id (LZ snapshot EID 40168 / Devnet).
pub fn production_endpoint_v2() -> Pubkey {
    "76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6"
        .parse()
        .expect("PRODUCTION_ENDPOINT_V2 base58")
}

pub fn is_production_endpoint(endpoint: &Pubkey) -> bool {
    *endpoint == production_endpoint_v2()
}

/// Endpoint program seeds (LZ `endpoint/src/lib.rs`).
pub const ENDPOINT_SEED: &[u8] = b"Endpoint";
pub const OAPP_SEED: &[u8] = b"OApp";
pub const NONCE_SEED: &[u8] = b"Nonce";
pub const PAYLOAD_HASH_SEED: &[u8] = b"PayloadHash";
pub const EVENT_SEED: &[u8] = b"__event_authority";

/// Anchor sighash `global:clear` — sha256[0..8].
pub const CLEAR_IX_DISCRIMINATOR: [u8; 8] = [250, 39, 28, 213, 123, 163, 133, 5];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClearParams {
    pub receiver: Pubkey,
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
    pub guid: [u8; 32],
    pub message: Vec<u8>,
}

impl ClearParams {
    pub fn encode_ix_data(&self) -> Vec<u8> {
        let mut data = Vec::with_capacity(8 + 32 + 4 + 32 + 8 + 32 + 4 + self.message.len());
        data.extend_from_slice(&CLEAR_IX_DISCRIMINATOR);
        data.extend_from_slice(self.receiver.as_ref());
        data.extend_from_slice(&self.src_eid.to_le_bytes());
        data.extend_from_slice(&self.sender);
        data.extend_from_slice(&self.nonce.to_le_bytes());
        data.extend_from_slice(&self.guid);
        data.extend_from_slice(&(self.message.len() as u32).to_le_bytes());
        data.extend_from_slice(&self.message);
        data
    }
}

/// Eight clear metas from `get_accounts_for_clear` (program id + 7 Clear/event accounts).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductionClearAccounts {
    pub endpoint_program: Pubkey,
    pub receiver: Pubkey,
    pub oapp_registry: Pubkey,
    pub nonce: Pubkey,
    pub payload_hash: Pubkey,
    pub endpoint_settings: Pubkey,
    pub event_authority: Pubkey,
}

pub fn production_clear_accounts(
    endpoint_program: &Pubkey,
    receiver: &Pubkey,
    src_eid: u32,
    sender: &[u8; 32],
    nonce: u64,
) -> ProductionClearAccounts {
    let (oapp_registry, _) =
        Pubkey::find_program_address(&[OAPP_SEED, receiver.as_ref()], endpoint_program);
    let (nonce_pda, _) = Pubkey::find_program_address(
        &[
            NONCE_SEED,
            receiver.as_ref(),
            &src_eid.to_be_bytes(),
            sender,
        ],
        endpoint_program,
    );
    let (payload_hash, _) = Pubkey::find_program_address(
        &[
            PAYLOAD_HASH_SEED,
            receiver.as_ref(),
            &src_eid.to_be_bytes(),
            sender,
            &nonce.to_be_bytes(),
        ],
        endpoint_program,
    );
    let (endpoint_settings, _) =
        Pubkey::find_program_address(&[ENDPOINT_SEED], endpoint_program);
    let (event_authority, _) = Pubkey::find_program_address(&[EVENT_SEED], endpoint_program);
    ProductionClearAccounts {
        endpoint_program: *endpoint_program,
        receiver: *receiver,
        oapp_registry,
        nonce: nonce_pda,
        payload_hash,
        endpoint_settings,
        event_authority,
    }
}

/// CPI EndpointV2 `clear` — must run before any Kargain state mutation.
pub fn cpi_clear_production<'info>(
    endpoint_program: &AccountInfo<'info>,
    receiver: &AccountInfo<'info>,
    oapp_registry: &AccountInfo<'info>,
    nonce: &AccountInfo<'info>,
    payload_hash: &AccountInfo<'info>,
    endpoint_settings: &AccountInfo<'info>,
    event_authority: &AccountInfo<'info>,
    params: &ClearParams,
    gateway_config_seeds: &[&[u8]],
) -> ProgramResult {
    if !is_production_endpoint(endpoint_program.key) {
        return Err(ProgramError::IncorrectProgramId);
    }
    if receiver.key != &params.receiver {
        return Err(ProgramError::InvalidArgument);
    }
    let data = params.encode_ix_data();
    let ix = Instruction {
        program_id: *endpoint_program.key,
        accounts: vec![
            AccountMeta::new_readonly(*endpoint_program.key, false),
            AccountMeta::new_readonly(*receiver.key, true),
            AccountMeta::new_readonly(*oapp_registry.key, false),
            AccountMeta::new(*nonce.key, false),
            AccountMeta::new(*payload_hash.key, false),
            AccountMeta::new(*endpoint_settings.key, false),
            AccountMeta::new_readonly(*event_authority.key, false),
            AccountMeta::new_readonly(*endpoint_program.key, false),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[
            endpoint_program.clone(),
            receiver.clone(),
            oapp_registry.clone(),
            nonce.clone(),
            payload_hash.clone(),
            endpoint_settings.clone(),
            event_authority.clone(),
            endpoint_program.clone(),
        ],
        &[gateway_config_seeds],
    )?;
    msg!(
        "kar-gateway endpointv2 clear ok src_eid={} nonce={}",
        params.src_eid,
        params.nonce
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_endpoint_parses() {
        let p = production_endpoint_v2();
        assert!(is_production_endpoint(&p));
        assert!(!is_production_endpoint(&Pubkey::new_unique()));
    }

    #[test]
    fn clear_discriminator_is_anchor_sighash() {
        let h = solana_program::hash::hash(b"global:clear");
        assert_eq!(&h.to_bytes()[..8], &CLEAR_IX_DISCRIMINATOR);
    }

    #[test]
    fn clear_accounts_stable_seeds() {
        let endpoint = production_endpoint_v2();
        let receiver = Pubkey::new_unique();
        let sender = [0xABu8; 32];
        let a = production_clear_accounts(&endpoint, &receiver, 40245, &sender, 7);
        let b = production_clear_accounts(&endpoint, &receiver, 40245, &sender, 7);
        assert_eq!(a, b);
        assert_eq!(a.endpoint_program, endpoint);
        assert_eq!(a.receiver, receiver);
        let (expected_oapp, _) =
            Pubkey::find_program_address(&[OAPP_SEED, receiver.as_ref()], &endpoint);
        assert_eq!(a.oapp_registry, expected_oapp);
    }

    #[test]
    fn clear_ix_data_prefix() {
        let receiver = Pubkey::new_unique();
        let params = ClearParams {
            receiver,
            src_eid: 40245,
            sender: [1u8; 32],
            nonce: 9,
            guid: [2u8; 32],
            message: vec![0xde, 0xad],
        };
        let data = params.encode_ix_data();
        assert_eq!(&data[..8], &CLEAR_IX_DISCRIMINATOR);
        assert_eq!(&data[8..40], receiver.as_ref());
    }
}
