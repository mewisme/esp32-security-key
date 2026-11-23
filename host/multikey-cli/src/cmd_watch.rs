//! `multikey device watch`: passkey activity on the key, live.
//!
//! The firmware pushes an event for every passkey registration (makeCredential), sign-in (getAssertion) and button wait
//! over the bulk IN endpoint of its vendor-class (WinUSB) interface: relying-party id, user name, algorithm, the
//! user-presence/verification flags and the CTAP2 error of a failed attempt. This command claims that interface and
//! prints them. It only reads; it cannot change anything on the key.
//!
//! Only one program can hold the interface at a time: close the web installer tab that is connected to the key first.
//! Events from before this command started can arrive first (the key keeps a few unread ones).

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use multikey_host::Error;
use multikey_proto::events::{
    algorithm_name, ctap_error_name, DeviceEvent, EventOp, EventReader, EventResult,
};
use nusb::descriptors::TransferType;
use nusb::transfer::{Bulk, Direction, In, TransferError};
use nusb::MaybeFuture;
use serde::Serialize;

use crate::console::Console;
use crate::error::{msg, CliError, Res};

/// The default USB id of the MultiKeys development firmware (docs/USB_IDENTITY.md).
pub const DEFAULT_USB_ID: (u16, u16) = (0x303A, 0x4002);

/// Parses `VID:PID` in hexadecimal.
pub fn parse_usb_id(s: &str) -> Result<(u16, u16), String> {
    let bad =
        || format!("`{s}` is not a USB id: write it as VID:PID in hexadecimal, e.g. 303a:4002");
    let (v, p) = s.split_once(':').ok_or_else(bad)?;
    let v = u16::from_str_radix(v.trim_start_matches("0x"), 16).map_err(|_| bad())?;
    let p = u16::from_str_radix(p.trim_start_matches("0x"), 16).map_err(|_| bad())?;
    Ok((v, p))
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct EventLine {
    /// When the event was read; absent for events the key had queued before this command started (their real time
    /// is unknown).
    pub time_utc: Option<String>,
    pub backlog: bool,
    pub op: &'static str,
    pub result: &'static str,
    pub rp_id: Option<String>,
    pub user_name: Option<String>,
    pub user_display_name: Option<String>,
    pub algorithm: Option<i32>,
    pub algorithm_name: Option<&'static str>,
    pub user_present: Option<bool>,
    pub user_verified: Option<bool>,
    pub error: Option<u8>,
    pub error_name: Option<&'static str>,
    pub credential_count: Option<u8>,
    /// For a button wait: the operation that needs the press.
    pub waiting_for: Option<&'static str>,
}

fn op_name(op: EventOp) -> &'static str {
    match op {
        EventOp::MakeCredential => "make_credential",
        EventOp::GetAssertion => "get_assertion",
        EventOp::UserPresence => "button_wait",
        EventOp::Other(_) => "other",
    }
}

fn result_name(r: EventResult) -> &'static str {
    match r {
        EventResult::Pending => "pending",
        EventResult::Ok => "ok",
        EventResult::Error => "error",
        EventResult::Other(_) => "other",
    }
}

pub fn to_line(ev: &DeviceEvent, time_utc: Option<&str>) -> EventLine {
    EventLine {
        backlog: time_utc.is_none(),
        time_utc: time_utc.map(str::to_owned),
        op: op_name(ev.op),
        result: result_name(ev.result),
        rp_id: ev.rp_id.clone(),
        user_name: ev.user_name.clone(),
        user_display_name: ev.user_display_name.clone(),
        algorithm: ev.algorithm,
        algorithm_name: ev.algorithm.and_then(algorithm_name),
        user_present: ev.user_present(),
        user_verified: ev.user_verified(),
        error: ev.error,
        error_name: ev.error.and_then(ctap_error_name),
        credential_count: ev.credential_count,
        waiting_for: ev.operation.map(op_name),
    }
}

/// One human-readable line.
pub fn describe(l: &EventLine) -> String {
    let site = l.rp_id.as_deref().unwrap_or("(unknown site)");
    let who = match (&l.user_name, &l.user_display_name) {
        (Some(n), Some(d)) if n != d => format!(" as {n} ({d})"),
        (Some(n), _) | (None, Some(n)) => format!(" as {n}"),
        (None, None) => String::new(),
    };
    let flags = match (l.user_present, l.user_verified) {
        (Some(up), Some(uv)) => format!(
            " [{}{}]",
            if up { "user present" } else { "no presence" },
            if uv { ", user verified" } else { "" }
        ),
        _ => String::new(),
    };
    let what = match (l.op, l.result) {
        ("make_credential", "ok") => {
            let alg = l
                .algorithm_name
                .map(|a| format!(" ({a})"))
                .unwrap_or_default();
            format!("passkey CREATED{alg} for {site}{who}{flags}")
        }
        ("get_assertion", "ok") => {
            let n = l
                .credential_count
                .filter(|n| *n > 1)
                .map(|n| format!(", {n} passkeys matched"))
                .unwrap_or_default();
            let verb = if l.user_present == Some(false) {
                "passkey LOOKED UP for"
            } else {
                "SIGNED IN to"
            };
            format!("{verb} {site}{who}{flags}{n}")
        }
        ("button_wait", _) => {
            let for_op = match l.waiting_for {
                Some("make_credential") => "to create a passkey",
                Some("get_assertion") => "to sign in",
                _ => "to confirm",
            };
            format!("waiting for the BOOT button {for_op} on {site}")
        }
        (op, _) => {
            let why = match (l.error_name, l.error) {
                (Some(n), Some(c)) => format!(": {n} ({c:#04x})"),
                (None, Some(c)) => format!(": error {c:#04x}"),
                _ => String::new(),
            };
            let action = match op {
                "make_credential" => "creating a passkey",
                "get_assertion" => "signing in",
                _ => "an operation",
            };
            format!("FAILED {action} on {site}{who}{why}")
        }
    };
    format!("{}  {what}", l.time_utc.as_deref().unwrap_or("earlier"))
}

/// `HH:MM:SS` of `secs` since the Unix epoch, in UTC.
pub fn hms_utc(secs: u64) -> String {
    let d = secs % 86_400;
    format!("{:02}:{:02}:{:02}Z", d / 3600, d / 60 % 60, d % 60)
}

fn now_utc() -> String {
    hms_utc(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs()),
    )
}

struct Wcid {
    interface: u8,
    ep_in: u8,
}

/// The vendor-class interface with one bulk IN and one bulk OUT endpoint.
fn find_wcid(device: &nusb::Device) -> Option<Wcid> {
    let config = device.active_configuration().ok()?;
    for iface in config.interfaces() {
        let Some(alt) = iface.alt_settings().next() else {
            continue;
        };
        if alt.class() != 0xFF {
            continue;
        }
        let eps: Vec<_> = alt
            .endpoints()
            .filter(|e| e.transfer_type() == TransferType::Bulk)
            .collect();
        let ep_in = eps.iter().find(|e| e.direction() == Direction::In);
        let has_out = eps.iter().any(|e| e.direction() == Direction::Out);
        if let (Some(ep_in), true) = (ep_in, has_out) {
            return Some(Wcid {
                interface: alt.interface_number(),
                ep_in: ep_in.address(),
            });
        }
    }
    None
}

pub fn watch(
    c: &mut dyn Console,
    json: bool,
    usb: Option<&str>,
    count: Option<u32>,
    timeout: Option<u64>,
) -> Res {
    let (vid, pid) = match usb {
        Some(s) => parse_usb_id(s).map_err(CliError::Usage)?,
        None => DEFAULT_USB_ID,
    };
    let mut found: Vec<_> = nusb::list_devices()
        .wait()
        .map_err(|e| msg(format!("cannot list USB devices: {e}")))?
        .filter(|d| d.vendor_id() == vid && d.product_id() == pid)
        .collect();
    let info = match found.len() {
        0 => return Err(CliError::Host(Error::NoDevice)),
        1 => found.remove(0),
        n => {
            return Err(CliError::Usage(format!(
                "{n} devices with USB id {vid:04x}:{pid:04x} are attached; unplug the others"
            )))
        }
    };
    let device = info.open().wait().map_err(|e| {
        msg(format!(
            "cannot open the key over USB: {e}. On Linux this needs access to the USB device (a udev rule for {vid:04x}:{pid:04x}); on Windows the vendor interface must use the WinUSB driver."
        ))
    })?;
    let wcid = find_wcid(&device).ok_or_else(|| {
        msg("this key has no vendor-class (WCID) interface; was the firmware built without it?")
    })?;
    let iface = device.claim_interface(wcid.interface).wait().map_err(|e| {
        msg(format!(
            "cannot claim the key's vendor interface: {e}. Close anything else that holds it, such as the web installer tab."
        ))
    })?;
    let mut ep = iface
        .endpoint::<Bulk, In>(wcid.ep_in)
        .map_err(|e| msg(format!("cannot open the IN endpoint: {e}")))?;

    if !json {
        writeln!(
            c.err(),
            "Watching {vid:04x}:{pid:04x} for passkey activity (times are UTC). Press Ctrl-C to stop."
        )
        .map_err(msg)?;
    }
    let started = Instant::now();
    let mut reader = EventReader::new();
    let mut seen = 0u32;
    let mut live = false;
    loop {
        if timeout.is_some_and(|t| started.elapsed() >= Duration::from_secs(t)) {
            return Ok(());
        }
        let done = ep.transfer_blocking(ep.allocate(512), Duration::from_millis(500));
        let data = &done.buffer[..done.actual_len.min(done.buffer.len())];
        for ev in reader.feed(data) {
            match ev {
                Ok(ev) => {
                    let line = to_line(&ev, live.then(now_utc).as_deref());
                    if json {
                        let s = serde_json::to_string(&line).map_err(msg)?;
                        writeln!(c.out(), "{s}").map_err(msg)?;
                    } else {
                        writeln!(c.out(), "{}", describe(&line)).map_err(msg)?;
                    }
                    seen += 1;
                    if count.is_some_and(|n| seen >= n) {
                        return Ok(());
                    }
                }
                Err(e) => writeln!(c.err(), "note: ignored a malformed event: {e}").map_err(msg)?,
            }
        }
        match done.status {
            Ok(()) => {}
            // The 500 ms wait ended with nothing to read: whatever the key had queued has been delivered, so
            // anything that arrives from now on happened while this command was watching.
            Err(TransferError::Cancelled) => live |= done.actual_len == 0,
            Err(TransferError::Disconnected) => {
                return Err(msg("the key was unplugged"));
            }
            Err(e) => return Err(msg(format!("USB read failed: {e}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use multikey_proto::events::EventReader;

    fn first(frame_hex: &str) -> EventLine {
        let ev = EventReader::new()
            .feed(&hex::decode(frame_hex).unwrap())
            .remove(0)
            .unwrap();
        to_line(&ev, Some("12:01:02Z"))
    }

    #[test]
    fn queued_events_are_marked_not_timed() {
        let ev = EventReader::new()
            .feed(&hex::decode(BUTTON_WAIT).unwrap())
            .remove(0)
            .unwrap();
        let l = to_line(&ev, None);
        assert!(l.backlog && l.time_utc.is_none());
        assert!(describe(&l).starts_with("earlier  waiting for the BOOT button"));
        let v = serde_json::to_value(&l).unwrap();
        assert_eq!(v["backlog"], true);
        assert!(v["time_utc"].is_null());
    }

    #[test]
    fn usb_ids() {
        assert_eq!(parse_usb_id("303a:4002"), Ok((0x303A, 0x4002)));
        assert_eq!(parse_usb_id("0x303A:0x4002"), Ok((0x303A, 0x4002)));
        assert!(parse_usb_id("303a").is_err());
        assert!(parse_usb_id("zz:1").is_err());
        assert!(parse_usb_id("10000:1").is_err());
    }

    #[test]
    fn utc_clock() {
        assert_eq!(hms_utc(0), "00:00:00Z");
        assert_eq!(hms_utc(86_399), "23:59:59Z");
        assert_eq!(hms_utc(86_400 + 3_723), "01:02:03Z");
    }

    // The same frames as multikey-proto/tests/events.rs.
    const MAKE_CREDENTIAL: &str = "7f290000000000010000010129010a6769746875622e636f6d0205616c6963650308416c69636520412e0404fffffff9050145";
    const GET_ASSERTION_FAILED: &str =
        "7f190000000000010000020219010b6578616d706c652e6f726705010107010206012e";
    const BUTTON_WAIT: &str = "7f120000000000010000030012080101010a6769746875622e636f6d";

    #[test]
    fn created_passkey_line() {
        let l = first(MAKE_CREDENTIAL);
        assert_eq!(l.algorithm_name, Some("ES256"));
        assert_eq!(
            describe(&l),
            "12:01:02Z  passkey CREATED (ES256) for github.com as alice (Alice A.) [user present, user verified]"
        );
    }

    #[test]
    fn failed_sign_in_line_names_the_ctap_error() {
        let l = first(GET_ASSERTION_FAILED);
        assert_eq!(l.error_name, Some("no credentials"));
        assert_eq!(
            describe(&l),
            "12:01:02Z  FAILED signing in on example.org: no credentials (0x2e)"
        );
    }

    #[test]
    fn a_sign_in_without_a_button_press_is_a_lookup() {
        // What Windows and Chrome send before asking for a touch (up=false); seen on the key as `ok`, UV set, UP clear.
        let l = first("7f11000000000001000002011101096c6f63616c686f7374050104");
        assert_eq!(l.user_present, Some(false));
        assert_eq!(l.user_verified, Some(true));
        assert_eq!(
            describe(&l),
            "12:01:02Z  passkey LOOKED UP for localhost [no presence, user verified]"
        );
    }

    #[test]
    fn button_wait_line_says_what_it_is_for() {
        assert_eq!(
            describe(&first(BUTTON_WAIT)),
            "12:01:02Z  waiting for the BOOT button to create a passkey on github.com"
        );
    }

    #[test]
    fn json_line_has_stable_fields() {
        let v = serde_json::to_value(first(MAKE_CREDENTIAL)).unwrap();
        assert_eq!(v["op"], "make_credential");
        assert_eq!(v["result"], "ok");
        assert_eq!(v["rp_id"], "github.com");
        assert_eq!(v["user_verified"], true);
        assert_eq!(v["algorithm"], -7);
    }
}
