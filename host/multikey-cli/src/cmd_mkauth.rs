//! `multikey mkauth ...` (and the legacy top-level `status|enroll|auth|list|revoke`): the MKAUTH v1 applet over
//! PC/SC plus the local trust store. The MKAUTH PIN is unrelated to the FIDO PIN.

use std::path::PathBuf;
use std::time::Duration;

use multikey_host::{Device, Error, KeyEntry, PcscTransport, TrustStore, TrustedKey};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::console::Console;
use crate::error::{msg, CliError, Res};
use crate::output::emit;
use crate::select::{pick_live, Need, SelectArgs};

/// How to find the device. Legacy commands keep their first-match behavior; the new group refuses ambiguity.
pub enum Opener {
    Legacy(Option<String>),
    Strict(SelectArgs),
}

impl Opener {
    pub fn open(&self) -> Result<Device<PcscTransport>, CliError> {
        let mut d = match self {
            Opener::Legacy(reader) => Device::open(reader.as_deref())?,
            Opener::Strict(args) => {
                let entry = pick_live(args, Need::Reader)?;
                let reader = entry.reader.ok_or(Error::NoDevice)?;
                Device::open(Some(&reader))?
            }
        };
        d.select()?;
        Ok(d)
    }
}

pub fn fingerprint(pubkey: &[u8]) -> String {
    let h = Sha256::digest(pubkey);
    h.chunks(2).map(hex::encode).collect::<Vec<_>>().join(":")
}

fn read_pin(c: &mut dyn Console, prompt: &str) -> Result<Vec<u8>, CliError> {
    c.secret(prompt).map(|s| s.as_bytes().to_vec())
}

fn confirm(c: &mut dyn Console, question: &str) -> bool {
    c.line(&format!("{question} "))
        .map(|s| s.trim() == "yes")
        .unwrap_or(false)
}

#[derive(Serialize)]
pub struct StatusReport {
    pub protocol_version: u8,
    pub enrolled: bool,
    pub policy: u8,
    pub device_id: String,
    pub public_key: Option<String>,
    pub fingerprint: Option<String>,
    pub device_name: Option<String>,
    pub device_name_custom: Option<bool>,
}

/// Read the MKAUTH state of an open device (shared by `mkauth status` and `device info|status`).
pub fn status_report(dev: &mut Device<PcscTransport>) -> Result<StatusReport, CliError> {
    let info = dev.info()?;
    let (device_name, device_name_custom) = match dev.device_name() {
        Ok(n) => (Some(n.name), Some(n.custom)),
        Err(Error::NameUnsupported) => (None, None),
        Err(e) => return Err(e.into()),
    };
    Ok(StatusReport {
        protocol_version: info.version,
        enrolled: info.enrolled,
        policy: info.policy,
        device_id: hex::encode(info.device_id),
        public_key: info.pubkey.map(hex::encode),
        fingerprint: info.pubkey.map(|pk| fingerprint(&pk)),
        device_name,
        device_name_custom,
    })
}

pub fn status(op: &Opener, c: &mut dyn Console, json: bool) -> Res {
    let mut dev = op.open()?;
    let r = status_report(&mut dev)?;
    emit(c.out(), json, &r, |w| {
        writeln!(w, "protocol version : {}", r.protocol_version)?;
        writeln!(w, "enrolled         : {}", r.enrolled)?;
        writeln!(
            w,
            "policy           : {:#04x} (bit0 = user presence required)",
            r.policy
        )?;
        writeln!(w, "device id        : {}", r.device_id)?;
        if let Some(pk) = &r.public_key {
            writeln!(w, "public key       : {pk}")?;
        }
        if let Some(f) = &r.fingerprint {
            writeln!(w, "fingerprint      : {f}")?;
        }
        match (&r.device_name, r.device_name_custom) {
            (Some(n), Some(custom)) => {
                writeln!(
                    w,
                    "device name      : {n}{}",
                    if custom { " (custom)" } else { " (default)" }
                )
            }
            _ => writeln!(w, "device name      : (firmware without INS 06)"),
        }
    })
}

pub fn enroll(op: &Opener, c: &mut dyn Console, user: &str, store_path: PathBuf, yes: bool) -> Res {
    let mut store = TrustStore::load_or_default(&store_path).map_err(msg)?;
    if store.find(user).is_some() {
        return Err(CliError::Msg(format!(
            "user {user:?} is already in {}",
            store_path.display()
        )));
    }
    let mut dev = op.open()?;
    if dev.info()?.enrolled {
        return Err(Error::AlreadyEnrolled.into());
    }
    let pin = read_pin(c, "New MKAUTH PIN (6-63 characters): ")?;
    if pin != read_pin(c, "Repeat PIN: ")? {
        return Err(CliError::Msg("PINs do not match".into()));
    }
    eprintln!("Press the device button to confirm enrollment...");
    let e = dev.enroll(&pin)?;
    writeln!(c.out(), "public key  : {}", hex::encode(e.pubkey)).map_err(msg)?;
    writeln!(c.out(), "device id   : {}", hex::encode(e.device_id)).map_err(msg)?;
    writeln!(c.out(), "fingerprint : {}", fingerprint(&e.pubkey)).map_err(msg)?;
    if !(yes || confirm(c, &format!("Trust this key for user {user:?}? Type 'yes':"))) {
        writeln!(c.out(), "Trust store NOT written. The device is enrolled; run `multikey mkauth revoke` to undo.")
            .map_err(msg)?;
        return Ok(());
    }
    store
        .add(KeyEntry::new(user, &e.pubkey, &e.device_id))
        .map_err(msg)?;
    store.save(&store_path).map_err(msg)?;
    writeln!(c.out(), "Wrote {}", store_path.display()).map_err(msg)?;
    Ok(())
}

pub fn auth(
    op: &Opener,
    c: &mut dyn Console,
    user: &str,
    store_path: PathBuf,
    timeout: u64,
) -> Res {
    let store = TrustStore::load(&store_path).map_err(msg)?;
    let entry = store
        .find(user)
        .ok_or_else(|| CliError::Msg(format!("user {user:?} not in trust store")))?;
    let key = TrustedKey::from_entry(entry).map_err(msg)?;
    let mut dev = op.open()?;
    eprintln!("Press the device button...");
    dev.authenticate(&key, Duration::from_secs(timeout))?;
    writeln!(c.out(), "authenticated {user}").map_err(msg)?;
    Ok(())
}

#[derive(Serialize)]
struct ListRow {
    user: String,
    device_id: String,
    fingerprint: String,
}

pub fn list(c: &mut dyn Console, store_path: PathBuf, json: bool) -> Res {
    let store = TrustStore::load(&store_path).map_err(msg)?;
    let mut rows = Vec::new();
    for k in store.entries() {
        let (pk, id) = k.decode().map_err(msg)?;
        rows.push(ListRow {
            user: k.user.clone(),
            device_id: hex::encode(id),
            fingerprint: fingerprint(&pk),
        });
    }
    emit(c.out(), json, &rows, |w| {
        for r in &rows {
            writeln!(w, "{}\t{}\t{}", r.user, r.device_id, r.fingerprint)?;
        }
        Ok(())
    })
}

pub fn revoke(op: &Opener, c: &mut dyn Console, user: &str, store_path: PathBuf) -> Res {
    let mut store = TrustStore::load(&store_path).map_err(msg)?;
    let entry = store
        .find(user)
        .ok_or_else(|| CliError::Msg(format!("user {user:?} not in trust store")))?;
    let (_, id) = entry.decode().map_err(msg)?;
    let mut dev = op.open()?;
    let info = dev.info()?;
    if !info.enrolled {
        return Err(Error::NotEnrolled.into());
    }
    if info.device_id != id {
        return Err(Error::DeviceMismatch.into());
    }
    let pin = read_pin(c, "MKAUTH PIN: ")?;
    eprintln!("Press the device button to confirm revocation...");
    dev.revoke(&pin)?;
    store.remove(user);
    store.save(&store_path).map_err(msg)?;
    writeln!(c.out(), "revoked {user}").map_err(msg)?;
    Ok(())
}

/// The MKAUTH PIN is only asked for once the device is enrolled (an unenrolled device has no PIN).
pub fn management_pin(
    dev: &mut Device<PcscTransport>,
    c: &mut dyn Console,
) -> Result<Vec<u8>, CliError> {
    if dev.info()?.enrolled {
        read_pin(c, "MKAUTH PIN: ")
    } else {
        Ok(Vec::new())
    }
}
