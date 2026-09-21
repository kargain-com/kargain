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
    /// Production EndpointV2 path consumes `native_fee` + `options` and CPI-sends;
    /// mock path ignores fee/options and returns message via `set_return_data`.
    Send {
        dst_eid: u32,
        to: [u8; 32],
        token_id: [u8; 32],
        native_fee: u64,
        options: Vec<u8>,
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
    /// Register this gateway_config PDA as an OApp with EndpointV2 (production only).
    RegisterOApp {
        /// Endpoint delegate (usually gateway config authority).
        delegate: [u8; 32],
    },
    /// Set PeerConfig.peer_address for `remote_eid` (star: hub 40245 only).
    SetPeer {
        remote_eid: u32,
        peer: [u8; 32],
    },
    /// Create `[LzReceiveTypes, gateway_config]` PDA for Executor V2 discovery.
    InitLzReceiveTypes,
}
