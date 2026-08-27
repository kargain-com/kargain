use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum GatewayIx {
    Initialize {
        local_eid: u32,
        endpoint_program: [u8; 32],
        passport_program: [u8; 32],
        namespace: u128,
    },
    /// Send: read URI before debit; always compose `abi.encode(uri)`.
    Send {
        dst_eid: u32,
        to: [u8; 32],
        token_id: [u8; 32],
    },
    /// Receive after Endpoint clear. Fail-closed on absent/undecodable compose.
    LzReceive {
        src_eid: u32,
        sender: [u8; 32],
        nonce: u64,
        guid: [u8; 32],
        /// Full ONFT message bytes.
        message: Vec<u8>,
    },
    /// Governed home restore — three preconditions; no mint (SPEC §12.11).
    RecoverLockedHome {
        token_id: [u8; 32],
        to: [u8; 32],
    },
    /// Deterministic account list for the executor (tokenId + config).
    LzReceiveTypes {
        message: Vec<u8>,
    },
}
