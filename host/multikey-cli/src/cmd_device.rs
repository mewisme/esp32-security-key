//! `multikey device ...`: inventory, combined info/status/version, and the device-name commands.
//!
//! `info`, `status` and `version` combine the two interfaces of the key: MKAUTH over PC/SC and FIDO over HID.
//! Each half reports "unavailable: <why>" when its transport is missing; neither hides the other.

use multikey_fido::{Authenticator, FidoInfo, HidAuthenticator, HidDevice, PinStatus};
use multikey_host::{inventory, DeviceEntry};
use multikey_proto::DeviceName;
use serde::Serialize;

use crate::cmd_mkauth::{management_pin, status_report, Opener, StatusReport};
use crate::console::Console;
use crate::error::{msg, CliError, Res};
use crate::output::emit;
use crate::select::{pick, Need, SelectArgs};

/// Windows opens FIDO HID interfaces only for elevated processes (a platform rule since 1903); hidapi then does
/// not list them at all for a normal user.
pub const WINDOWS_HID_HINT: &str = if cfg!(windows) {
    "hint: on Windows the FIDO HID interface is only visible to an elevated (Administrator) terminal. If `multikey device list` shows a reader but no HID interface, rerun this command in an elevated terminal."
} else {
    "hint: no FIDO HID interface found. On Linux check the udev rules for hidraw access (members of the plugdev group, or a rule for this VID:PID)."
};

pub fn list(c: &mut dyn Console, json: bool) -> Res {
    let inv = inventory();
    if let Some(why) = &inv.pcsc_error {
        writeln!(c.err(), "note: smart-card (PC/SC) side unavailable: {why}").map_err(msg)?;
    }
    if inv.entries.iter().any(|e| e.hid.is_none()) {
        writeln!(c.err(), "{WINDOWS_HID_HINT}").map_err(msg)?;
    }
    emit(c.out(), json, &inv.entries, |w| {
        if inv.entries.is_empty() {
            return writeln!(w, "(no MultiKeys devices found)");
        }
        for e in &inv.entries {
            writeln!(w, "{}", e.describe())?;
        }
        Ok(())
    })
}

/// One half of a report: the data, or why it is not available.
#[derive(Serialize)]
pub struct Section<T: Serialize> {
    pub available: bool,
    pub error: Option<String>,
    pub data: Option<T>,
}

impl<T: Serialize> Section<T> {
    fn from(r: Result<T, String>) -> Self {
        match r {
            Ok(d) => Self {
                available: true,
                error: None,
                data: Some(d),
            },
            Err(e) => Self {
                available: false,
                error: Some(e),
                data: None,
            },
        }
    }
}

fn err_text(e: CliError) -> String {
    crate::error::message(&e)
}

fn mkauth_part(entry: &DeviceEntry, inv_pcsc_error: Option<&str>) -> Result<StatusReport, String> {
    let Some(reader) = &entry.reader else {
        return Err(match inv_pcsc_error {
            Some(why) => format!("smart-card side unavailable: {why}"),
            None => "no CCID reader paired with this device".to_string(),
        });
    };
    let args = SelectArgs {
        reader: Some(reader.clone()),
        ..Default::default()
    };
    let mut dev = Opener::Strict(args).open().map_err(err_text)?;
    status_report(&mut dev).map_err(err_text)
}

fn fido_part<T>(
    entry: &DeviceEntry,
    f: impl FnOnce(&HidAuthenticator) -> Result<T, multikey_fido::FidoError>,
) -> Result<T, String> {
    let Some(hid) = &entry.hid else {
        return Err(format!(
            "no FIDO HID interface found for this device ({WINDOWS_HID_HINT})"
        ));
    };
    let a = HidAuthenticator::open(&hid.path).map_err(|e| e.to_string())?;
    f(&a).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct InfoReport {
    pub entry: DeviceEntry,
    pub mkauth: Section<StatusReport>,
    pub fido: Section<FidoInfo>,
}

pub fn info(c: &mut dyn Console, args: &SelectArgs, json: bool) -> Res {
    let inv = inventory();
    let entry = pick(&inv, args, Need::Any)?;
    let report = InfoReport {
        mkauth: Section::from(mkauth_part(&entry, inv.pcsc_error.as_deref())),
        fido: Section::from(fido_part(&entry, |a| a.info())),
        entry,
    };
    emit(c.out(), json, &report, |w| {
        writeln!(w, "device           : {}", report.entry.describe())?;
        match &report.mkauth.data {
            Some(m) => {
                writeln!(
                    w,
                    "MKAUTH           : protocol v{}, enrolled={}",
                    m.protocol_version, m.enrolled
                )?;
                if let Some(n) = &m.device_name {
                    writeln!(
                        w,
                        "device name      : {n}{}",
                        if m.device_name_custom == Some(true) {
                            " (custom)"
                        } else {
                            " (default)"
                        }
                    )?;
                }
            }
            None => writeln!(
                w,
                "MKAUTH           : unavailable: {}",
                report.mkauth.error.as_deref().unwrap_or("?")
            )?,
        }
        match &report.fido.data {
            Some(f) => {
                writeln!(w, "FIDO             : {}", f.versions.join(", "))?;
                writeln!(w, "aaguid           : {}", f.aaguid)?;
            }
            None => writeln!(
                w,
                "FIDO             : unavailable: {}",
                report.fido.error.as_deref().unwrap_or("?")
            )?,
        }
        if let Some(h) = &report.entry.hid {
            writeln!(
                w,
                "USB              : {:04x}:{:04x} \"{}\"",
                h.vid, h.pid, h.product
            )?;
        }
        Ok(())
    })
}

#[derive(Serialize)]
pub struct StatusSummary {
    pub entry: DeviceEntry,
    pub mkauth: Section<StatusReport>,
    pub fido: Section<PinStatus>,
}

pub fn status(c: &mut dyn Console, args: &SelectArgs, json: bool) -> Res {
    let inv = inventory();
    let entry = pick(&inv, args, Need::Any)?;
    let report = StatusSummary {
        mkauth: Section::from(mkauth_part(&entry, inv.pcsc_error.as_deref())),
        fido: Section::from(fido_part(&entry, |a| a.pin_status())),
        entry,
    };
    emit(c.out(), json, &report, |w| {
        writeln!(w, "device           : {}", report.entry.describe())?;
        match &report.mkauth.data {
            Some(m) => writeln!(
                w,
                "MKAUTH           : enrolled={}, policy={:#04x}",
                m.enrolled, m.policy
            )?,
            None => writeln!(
                w,
                "MKAUTH           : unavailable: {}",
                report.mkauth.error.as_deref().unwrap_or("?")
            )?,
        }
        match &report.fido.data {
            Some(p) => {
                writeln!(
                    w,
                    "FIDO PIN         : {:?}{}",
                    p.client_pin,
                    p.retries
                        .map(|r| format!(", {r} retries"))
                        .unwrap_or_default()
                )?;
                writeln!(
                    w,
                    "makeCredUvNotRqd : {}",
                    p.make_cred_uv_not_rqd
                        .map_or("-".to_string(), |v| v.to_string())
                )?;
            }
            None => writeln!(
                w,
                "FIDO             : unavailable: {}",
                report.fido.error.as_deref().unwrap_or("?")
            )?,
        }
        Ok(())
    })
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct VersionReport {
    /// Version of this tool.
    pub host_tool: String,
    /// MKAUTH protocol version byte reported by the applet (not a firmware build id).
    pub mkauth_protocol: Option<u8>,
    /// authenticatorGetInfo firmwareVersion: the upstream pico-fido core version, not a MultiKeys build id.
    pub ctap_firmware_version: Option<u32>,
    pub ctap_versions: Vec<String>,
    pub usb_vid: Option<u16>,
    pub usb_pid: Option<u16>,
    pub usb_product: Option<String>,
    pub note: &'static str,
}

pub const VERSION_NOTE: &str =
    "The firmware does not report a MultiKeys build identifier; only the protocol versions above exist.";

pub fn build_version(
    host: &str,
    mkauth: Option<u8>,
    fido: Option<&FidoInfo>,
    hid: Option<&HidDevice>,
) -> VersionReport {
    VersionReport {
        host_tool: host.to_string(),
        mkauth_protocol: mkauth,
        ctap_firmware_version: fido.and_then(|f| f.firmware_version),
        ctap_versions: fido.map(|f| f.versions.clone()).unwrap_or_default(),
        usb_vid: hid.map(|h| h.vid),
        usb_pid: hid.map(|h| h.pid),
        usb_product: hid.map(|h| h.product.clone()),
        note: VERSION_NOTE,
    }
}

pub fn version(c: &mut dyn Console, args: &SelectArgs, json: bool) -> Res {
    let inv = inventory();
    let entry = pick(&inv, args, Need::Any)?;
    let mk = mkauth_part(&entry, inv.pcsc_error.as_deref())
        .ok()
        .map(|m| m.protocol_version);
    let fido = fido_part(&entry, |a| a.info()).ok();
    let r = build_version(
        env!("CARGO_PKG_VERSION"),
        mk,
        fido.as_ref(),
        entry.hid.as_ref(),
    );
    emit(c.out(), json, &r, |w| {
        writeln!(w, "multikey tool    : {}", r.host_tool)?;
        match r.mkauth_protocol {
            Some(v) => writeln!(w, "MKAUTH protocol  : {v}")?,
            None => writeln!(w, "MKAUTH protocol  : unavailable")?,
        }
        match r.ctap_firmware_version {
            Some(v) => writeln!(
                w,
                "CTAP fw version  : {v:#x} (pico-fido core version, not a MultiKeys build id)"
            )?,
            None => writeln!(w, "CTAP fw version  : unavailable")?,
        }
        if let (Some(vid), Some(pid), Some(p)) = (r.usb_vid, r.usb_pid, &r.usb_product) {
            writeln!(w, "USB              : {vid:04x}:{pid:04x} \"{p}\"")?;
        }
        writeln!(w, "note             : {}", r.note)
    })
}

fn print_name(c: &mut dyn Console, n: &DeviceName) -> Res {
    writeln!(
        c.out(),
        "device name     : {}{}",
        n.name,
        if n.custom { " (custom)" } else { " (default)" }
    )
    .map_err(msg)?;
    if n.reenumeration_pending {
        writeln!(c.out(), "note            : the host still sees the old name; unplug and replug the key, or run `multikey device reenumerate`").map_err(msg)?;
    }
    Ok(())
}

pub fn show(op: &Opener, c: &mut dyn Console) -> Res {
    let n = op.open()?.device_name()?;
    print_name(c, &n)?;
    writeln!(c.out(), "pending         : {}", n.reenumeration_pending).map_err(msg)?;
    writeln!(c.out(), "rename enabled  : {}", n.rename_supported).map_err(msg)?;
    Ok(())
}

pub fn rename(op: &Opener, c: &mut dyn Console, name: &str, reenumerate: bool) -> Res {
    // Reject bad names before the device is touched or a PIN is asked for.
    multikey_proto::validate_device_name(name).map_err(msg)?;
    let mut dev = op.open()?;
    let pin = management_pin(&mut dev, c)?;
    eprintln!("Press the device button to confirm the new name...");
    let mut n = dev.set_device_name(&pin, name, reenumerate)?;
    n.reenumeration_pending &= !reenumerate;
    print_name(c, &n)?;
    if reenumerate {
        writeln!(
            c.out(),
            "the device detaches from USB for about a second; the new name is used afterwards"
        )
        .map_err(msg)?;
    }
    Ok(())
}

pub fn reset_name(op: &Opener, c: &mut dyn Console, reenumerate: bool) -> Res {
    let mut dev = op.open()?;
    let pin = management_pin(&mut dev, c)?;
    eprintln!("Press the device button to restore the default name...");
    let mut n = dev.clear_device_name(&pin, reenumerate)?;
    n.reenumeration_pending &= !reenumerate;
    print_name(c, &n)?;
    if reenumerate {
        writeln!(
            c.out(),
            "the device detaches from USB for about a second; the default name is used afterwards"
        )
        .map_err(msg)?;
    }
    Ok(())
}

pub fn reenumerate(op: &Opener, c: &mut dyn Console) -> Res {
    let mut dev = op.open()?;
    let pin = management_pin(&mut dev, c)?;
    eprintln!("Press the device button to confirm...");
    dev.reenumerate(&pin)?;
    writeln!(c.out(), "the device detaches from USB for about a second").map_err(msg)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::console::testing::TestConsole;
    use multikey_host::pair;

    fn hid() -> HidDevice {
        HidDevice {
            index: 0,
            path: "p1".into(),
            vid: 0x303A,
            pid: 0x4002,
            product: "MultiKeys Security Key".into(),
            serial: None,
        }
    }

    #[test]
    fn list_json_shape() {
        let entries = pair(
            vec![hid()],
            vec!["MultiKeys MultiKeys Security Key CCID 0".into()],
        );
        let mut c = TestConsole::default();
        emit(c.out(), true, &entries, |_| Ok(())).unwrap();
        let v: serde_json::Value = serde_json::from_str(&c.stdout()).unwrap();
        assert_eq!(v[0]["paired"], true);
        assert_eq!(v[0]["index"], 0);
        assert_eq!(v[0]["hid"]["vid"], 0x303A);
        assert_eq!(v[0]["hid"]["product"], "MultiKeys Security Key");
        assert_eq!(v[0]["reader"], "MultiKeys MultiKeys Security Key CCID 0");
    }

    #[test]
    fn empty_list_json_is_empty_array() {
        let entries: Vec<DeviceEntry> = vec![];
        let mut c = TestConsole::default();
        emit(c.out(), true, &entries, |_| Ok(())).unwrap();
        assert_eq!(c.stdout().trim(), "[]");
    }

    #[test]
    fn version_json_fields() {
        let fido = FidoInfo {
            versions: vec!["FIDO_2_1".into()],
            aaguid: "00".repeat(16),
            firmware_version: Some(0x0809),
            options: Default::default(),
            extensions: vec![],
            pin_protocols: vec![],
            min_pin_length: None,
        };
        let r = build_version("0.1.0", Some(1), Some(&fido), Some(&hid()));
        let mut c = TestConsole::default();
        emit(c.out(), true, &r, |_| Ok(())).unwrap();
        let v: serde_json::Value = serde_json::from_str(&c.stdout()).unwrap();
        assert_eq!(v["host_tool"], "0.1.0");
        assert_eq!(v["mkauth_protocol"], 1);
        assert_eq!(v["ctap_firmware_version"], 0x0809);
        assert_eq!(v["usb_pid"], 0x4002);
        assert!(v["note"].as_str().unwrap().contains("build identifier"));
    }

    #[test]
    fn version_without_transports_is_all_null() {
        let r = build_version("0.1.0", None, None, None);
        assert_eq!(r.mkauth_protocol, None);
        assert_eq!(r.ctap_firmware_version, None);
        assert!(r.ctap_versions.is_empty());
    }
}
