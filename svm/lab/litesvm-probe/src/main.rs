//! Lab-only LiteSVM 0.16 TransferV1 probe. Same .so bytes as 6d / H1. Not a product crate.

use std::env;
use std::fs;
use std::path::Path;

use litesvm::LiteSVM;
use solana_address::Address;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

const CORE: Address = solana_address::address!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const SYSTEM: Address = solana_address::address!("11111111111111111111111111111111");

fn enc_string(s: &str) -> Vec<u8> {
    let body = s.as_bytes();
    let mut out = Vec::with_capacity(4 + body.len());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(body);
    out
}

fn mpl_create_v1_data(name: &str, uri: &str) -> Vec<u8> {
    let mut d = vec![0u8, 0u8]; // CreateV1 disc + AccountState
    d.extend_from_slice(&enc_string(name));
    d.extend_from_slice(&enc_string(uri));
    d.push(0); // plugins None
    d
}

fn mpl_transfer_v1_data() -> Vec<u8> {
    vec![14, 0] // TransferV1 disc + compressionProof None
}

fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    extra: &[&Keypair],
    ix: Instruction,
) -> Result<String, String> {
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&signers, msg, svm.latest_blockhash());
    match svm.send_transaction(tx) {
        Ok(meta) => Ok(format!("ok cu={}", meta.compute_units_consumed)),
        Err(e) => Err(format!("{e:?}")),
    }
}

fn json_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: litesvm-probe <mpl_core.so> <harness.so> <harness-keypair.json>");
        std::process::exit(2);
    }
    let core_so = Path::new(&args[1]);
    let harness_so = Path::new(&args[2]);
    let harness_kp = Path::new(&args[3]);
    let secret: Vec<u8> = serde_json_from_keypair(harness_kp);
    let harness_id = Keypair::try_from(secret.as_slice())
        .expect("harness keypair")
        .pubkey();

    let mut svm = LiteSVM::new();
    if let Err(e) = svm.add_program_from_file(CORE, core_so) {
        print_fail("load_mpl_core", &format!("{e:?}"));
        return;
    }
    if let Err(e) = svm.add_program_from_file(harness_id, harness_so) {
        print_fail("load_harness", &format!("{e:?}"));
        return;
    }

    let a = run_a(&mut svm, harness_id);
    let b = run_b(&mut svm, harness_id);
    let a_ok = a.starts_with("A ok");
    let b_ok = b.starts_with("B ok");
    let a_xfer = a.contains("transfer_fault") || a.starts_with("A ");
    let b_xfer = b.contains("transfer_fault") || b.starts_with("B ");
    let verdict = if a_ok && b_ok {
        "transfer_ok both A and B"
    } else if a.contains("create_failed") && b.contains("create_failed") {
        "create_failed both"
    } else if !a_ok && !b_ok && a_xfer && b_xfer {
        "transfer_fault both — mpl-core + LiteSVM rust 0.16 (Agave 4.2.1), same as Node 1.4.1"
    } else if a_ok {
        "A ok; B fault"
    } else if b_ok {
        "A fault; B ok"
    } else {
        "mixed — see A/B"
    };
    println!(
        "{{\"runtime\":\"litesvm-rs 0.16.0\",\"agave\":\"4.2.1\",\"A\":\"{}\",\"B\":\"{}\",\"verdict\":\"{}\"}}",
        json_escape(&a),
        json_escape(&b),
        json_escape(verdict)
    );
}

fn serde_json_from_keypair(path: &Path) -> Vec<u8> {
    let raw = fs::read_to_string(path).expect("read keypair");
    let vals: Vec<u8> = raw
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(|s| s.trim().parse::<u8>().expect("byte"))
        .collect();
    vals
}

fn run_a(svm: &mut LiteSVM, harness: Address) -> String {
    let payer = Keypair::new();
    let owner = Keypair::new();
    let asset_kp = Keypair::new();
    let new_owner = Keypair::new();
    let _ = svm.airdrop(&payer.pubkey(), 20_000_000_000);
    let _ = svm.airdrop(&owner.pubkey(), 20_000_000_000);
    let create = Instruction {
        program_id: CORE,
        accounts: vec![
            AccountMeta::new(asset_kp.pubkey(), true),
            AccountMeta::new_readonly(CORE, false),
            AccountMeta::new_readonly(CORE, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(owner.pubkey(), false),
            AccountMeta::new_readonly(payer.pubkey(), false),
            AccountMeta::new_readonly(SYSTEM, false),
            AccountMeta::new_readonly(CORE, false),
        ],
        data: mpl_create_v1_data("6d2-h3", "ar://6d2-h3"),
    };
    let mut asset_addr = asset_kp.pubkey();
    let mut authority = owner.insecure_clone();
    if let Err(_e) = send(svm, &payer, &[&asset_kp], create) {
        let (fallback_asset, fallback_owner) = match harness_create(svm, harness) {
            Ok(v) => v,
            Err(e) => return format!("create_failed {e}"),
        };
        asset_addr = fallback_asset;
        authority = fallback_owner;
    }
    let transfer = Instruction {
        program_id: CORE,
        accounts: vec![
            AccountMeta::new(asset_addr, false),
            AccountMeta::new_readonly(CORE, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(authority.pubkey(), true),
            AccountMeta::new_readonly(new_owner.pubkey(), false),
            AccountMeta::new_readonly(SYSTEM, false),
            AccountMeta::new_readonly(CORE, false),
        ],
        data: mpl_transfer_v1_data(),
    };
    match send(svm, &payer, &[&authority], transfer) {
        Ok(s) => format!("A {s}"),
        Err(e) => format!("A transfer_fault {e}"),
    }
}

fn harness_create(svm: &mut LiteSVM, harness: Address) -> Result<(Address, Keypair), String> {
    let payer = Keypair::new();
    let owner = Keypair::new();
    let _ = svm.airdrop(&payer.pubkey(), 20_000_000_000);
    let _ = svm.airdrop(&owner.pubkey(), 20_000_000_000);
    let mut token = [0u8; 32];
    token[31] = 0x61;
    let (asset, _) = Address::find_program_address(&[b"asset", &token], &harness);
    let (freeze, _) = Address::find_program_address(&[b"freeze"], &harness);
    let mut create_data = vec![21u8];
    create_data.extend_from_slice(&token);
    create_data.extend_from_slice(&[0u8, 0u8]);
    let create = Instruction {
        program_id: harness,
        accounts: vec![
            AccountMeta::new(asset, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(owner.pubkey(), false),
            AccountMeta::new_readonly(freeze, false),
            AccountMeta::new_readonly(CORE, false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
        data: create_data,
    };
    send(svm, &payer, &[], create)?;
    Ok((asset, owner))
}

fn run_b(svm: &mut LiteSVM, harness: Address) -> String {
    let payer = Keypair::new();
    let seller = Keypair::new();
    let _ = svm.airdrop(&payer.pubkey(), 20_000_000_000);
    let _ = svm.airdrop(&seller.pubkey(), 20_000_000_000);
    let mut token = [0u8; 32];
    token[31] = 0x6e;
    let (asset, _) = Address::find_program_address(&[b"asset", &token], &harness);
    let (custody, _) = Address::find_program_address(&[b"custody"], &harness);
    let (freeze, _) = Address::find_program_address(&[b"freeze"], &harness);
    let mut create_data = vec![21u8];
    create_data.extend_from_slice(&token);
    create_data.extend_from_slice(&[0u8, 0u8]);
    let create = Instruction {
        program_id: harness,
        accounts: vec![
            AccountMeta::new(asset, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(seller.pubkey(), false),
            AccountMeta::new_readonly(freeze, false),
            AccountMeta::new_readonly(CORE, false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
        data: create_data,
    };
    if let Err(e) = send(svm, &payer, &[], create) {
        return format!("create_failed {e}");
    }
    let mut xfer_data = vec![22u8];
    xfer_data.extend_from_slice(&token);
    let transfer = Instruction {
        program_id: harness,
        accounts: vec![
            AccountMeta::new(asset, false),
            AccountMeta::new_readonly(seller.pubkey(), true),
            AccountMeta::new_readonly(custody, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(CORE, false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
        data: xfer_data,
    };
    match send(svm, &payer, &[&seller], transfer) {
        Ok(s) => format!("B {s}"),
        Err(e) => format!("B transfer_fault {e}"),
    }
}

fn print_fail(stage: &str, err: &str) {
    println!(
        "{{\"runtime\":\"litesvm-rs 0.16.0\",\"verdict\":\"rust_probe_failed_to_run\",\"stage\":\"{}\",\"err\":\"{}\"}}",
        json_escape(stage),
        json_escape(err)
    );
}
