//! Live events of the key: what pico-fido's `event_send` pushes to the host while a passkey operation runs.
//!
//! They arrive as `CCID_EVENT` (0x7F) messages on the bulk IN endpoint of the vendor-class (WCID) interface, the same
//! interface the web installer uses for MKAUTH:
//!
//! ```text
//! CCID header (10): 7F | dwLength (LE32) | bSlot=0 | bSeq=0 | status | 00
//! payload:          op (1) | result (1) | total length (1) | { type (1) | len (1) | value }...
//! ```
//!
//! `total length` counts the whole payload. Text fields (RP id, user name, display name) are what the relying party
//! sent; they can be cut short by the firmware, can end inside a UTF-8 sequence, and are untrusted: this module turns
//! control and bidirectional-formatting characters into U+FFFD so they can be printed safely.

use crate::ProtoError;

/// `bMessageType` of an event message.
pub const CCID_EVENT: u8 = 0x7F;
/// Size of the CCID message header.
pub const CCID_HEADER_LEN: usize = 10;
/// Largest message the reader accepts (an event payload is at most 255 bytes).
const MAX_MESSAGE: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventOp {
    /// authenticatorMakeCredential (a passkey is being registered).
    MakeCredential,
    /// authenticatorGetAssertion (a passkey is being used to sign in).
    GetAssertion,
    /// The key is waiting for the BOOT button.
    UserPresence,
    Other(u8),
}

impl From<u8> for EventOp {
    fn from(b: u8) -> Self {
        match b {
            1 => Self::MakeCredential,
            2 => Self::GetAssertion,
            3 => Self::UserPresence,
            o => Self::Other(o),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventResult {
    /// No result yet (the event announces something, e.g. a button wait).
    Pending,
    Ok,
    Error,
    Other(u8),
}

impl From<u8> for EventResult {
    fn from(b: u8) -> Self {
        match b {
            0 => Self::Pending,
            1 => Self::Ok,
            2 => Self::Error,
            o => Self::Other(o),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceEvent {
    pub op: EventOp,
    pub result: EventResult,
    /// Relying party id, e.g. `github.com` (sanitized, possibly cut short).
    pub rp_id: Option<String>,
    pub user_name: Option<String>,
    pub user_display_name: Option<String>,
    /// COSE algorithm identifier of the new credential (make credential).
    pub algorithm: Option<i32>,
    /// WebAuthn authenticator-data flags (UP 0x01, UV 0x04, BE 0x08, BS 0x10, AT 0x40, ED 0x80).
    pub auth_flags: Option<u8>,
    /// CTAP2 status code of a failed operation.
    pub error: Option<u8>,
    /// Credentials that matched a sign-in request.
    pub credential_count: Option<u8>,
    /// For a button wait: the operation that needs the press.
    pub operation: Option<EventOp>,
}

impl DeviceEvent {
    pub fn user_present(&self) -> Option<bool> {
        self.auth_flags.map(|f| f & 0x01 != 0)
    }

    pub fn user_verified(&self) -> Option<bool> {
        self.auth_flags.map(|f| f & 0x04 != 0)
    }
}

/// Decodes text a relying party chose: lossy UTF-8, with control and bidirectional-formatting characters replaced.
pub fn sanitize_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .map(|c| {
            let bidi = matches!(c, '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}');
            if c.is_control() || bidi {
                '\u{FFFD}'
            } else {
                c
            }
        })
        .collect()
}

/// Decodes one event payload (the bytes after the CCID header).
pub fn parse_event(payload: &[u8]) -> Result<DeviceEvent, ProtoError> {
    let bad = |what: &'static str| ProtoError::BadLength {
        what,
        len: payload.len(),
    };
    if payload.len() < 3 || usize::from(payload[2]) != payload.len() {
        return Err(bad("event"));
    }
    let mut ev = DeviceEvent {
        op: payload[0].into(),
        result: payload[1].into(),
        rp_id: None,
        user_name: None,
        user_display_name: None,
        algorithm: None,
        auth_flags: None,
        error: None,
        credential_count: None,
        operation: None,
    };
    let one = |v: &[u8]| -> Result<u8, ProtoError> {
        match v {
            [b] => Ok(*b),
            _ => Err(bad("event (field has the wrong length)")),
        }
    };
    let mut rest = &payload[3..];
    while !rest.is_empty() {
        let (Some(&tag), Some(&len)) = (rest.first(), rest.get(1)) else {
            return Err(bad("event (truncated field)"));
        };
        let Some(v) = rest.get(2..2 + usize::from(len)) else {
            return Err(bad("event (truncated field)"));
        };
        rest = &rest[2 + usize::from(len)..];
        match tag {
            1 => ev.rp_id = Some(sanitize_text(v)),
            2 => ev.user_name = Some(sanitize_text(v)),
            3 => ev.user_display_name = Some(sanitize_text(v)),
            4 => {
                let a: [u8; 4] = v
                    .try_into()
                    .map_err(|_| bad("event (field has the wrong length)"))?;
                ev.algorithm = Some(i32::from_be_bytes(a));
            }
            5 => ev.auth_flags = Some(one(v)?),
            6 => ev.error = Some(one(v)?),
            7 => ev.credential_count = Some(one(v)?),
            8 => ev.operation = Some(one(v)?.into()),
            _ => {} // a field from a newer firmware
        }
    }
    Ok(ev)
}

/// Reassembles CCID messages from the raw bytes read off the endpoint and decodes the events among them. Replies to
/// commands and any other message type are skipped.
#[derive(Debug, Default)]
pub struct EventReader {
    buf: Vec<u8>,
}

impl EventReader {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed(&mut self, data: &[u8]) -> Vec<Result<DeviceEvent, ProtoError>> {
        self.buf.extend_from_slice(data);
        let mut out = Vec::new();
        loop {
            if self.buf.len() < CCID_HEADER_LEN {
                break;
            }
            let len =
                u32::from_le_bytes([self.buf[1], self.buf[2], self.buf[3], self.buf[4]]) as usize;
            if len > MAX_MESSAGE {
                // Out of step with the stream: drop what is buffered rather than guess where a message starts.
                let n = self.buf.len();
                self.buf.clear();
                out.push(Err(ProtoError::BadLength {
                    what: "CCID message length",
                    len: n,
                }));
                break;
            }
            if self.buf.len() < CCID_HEADER_LEN + len {
                break;
            }
            let msg: Vec<u8> = self.buf.drain(..CCID_HEADER_LEN + len).collect();
            if msg[0] == CCID_EVENT {
                out.push(parse_event(&msg[CCID_HEADER_LEN..]));
            }
        }
        out
    }
}

/// Name of a COSE algorithm identifier.
pub fn algorithm_name(alg: i32) -> Option<&'static str> {
    Some(match alg {
        -7 => "ES256",
        -8 => "EdDSA",
        -35 => "ES384",
        -36 => "ES512",
        -47 => "ES256K",
        -257 => "RS256",
        _ => return None,
    })
}

/// Name of a CTAP2 status code (`CTAP2_ERR_*`).
pub fn ctap_error_name(code: u8) -> Option<&'static str> {
    Some(match code {
        0x11 => "CBOR unexpected type",
        0x12 => "invalid CBOR",
        0x14 => "missing parameter",
        0x15 => "limit exceeded",
        0x19 => "credential excluded",
        0x21 => "processing",
        0x22 => "invalid credential",
        0x23 => "user action pending",
        0x24 => "operation pending",
        0x25 => "no operations",
        0x26 => "unsupported algorithm",
        0x27 => "operation denied",
        0x28 => "key store full",
        0x2B => "unsupported option",
        0x2C => "invalid option",
        0x2D => "keepalive cancel",
        0x2E => "no credentials",
        0x2F => "user action timeout",
        0x30 => "not allowed",
        0x31 => "PIN invalid",
        0x32 => "PIN blocked",
        0x33 => "PIN auth invalid",
        0x34 => "PIN auth blocked",
        0x35 => "PIN not set",
        0x36 => "PIN/UV auth token required",
        0x37 => "PIN policy violation",
        0x39 => "request too large",
        0x3A => "action timeout",
        0x3B => "user presence required",
        0x3C => "UV blocked",
        0x3D => "integrity failure",
        0x3E => "invalid subcommand",
        0x3F => "UV invalid",
        0x40 => "unauthorized permission",
        _ => return None,
    })
}
