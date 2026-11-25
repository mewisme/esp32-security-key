//! MKAUTH v1 wire protocol (see `docs/PROTOCOLS.md`). Pure library: no I/O.

use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use thiserror::Error;

pub mod events;

/// Applet identifier.
pub const AID: [u8; 8] = [0xF0, 0x4D, 0x4B, 0x41, 0x55, 0x54, 0x48, 0x01];
/// Expected SELECT response data.
pub const SELECT_RESPONSE: &[u8; 8] = b"MKAUTH 1";
pub const CLA: u8 = 0x80;
pub const INS_GET_INFO: u8 = 0x01;
pub const INS_ENROLL: u8 = 0x02;
pub const INS_CHALLENGE: u8 = 0x03;
pub const INS_REVOKE: u8 = 0x04;
pub const INS_DEVICE_NAME: u8 = 0x06;
pub const INS_BUILD_INFO: u8 = 0x07;
/// First byte of a BUILD_INFO response.
pub const BUILD_INFO_FORMAT: u8 = 0x01;
/// Longest device name in bytes (one esp_tinyusb string descriptor).
pub const NAME_MAX: usize = 31;
pub const NAME_GET: u8 = 0x00;
pub const NAME_SET: u8 = 0x01;
pub const NAME_CLEAR: u8 = 0x02;
pub const NAME_REENUM: u8 = 0x03;
pub const PROTOCOL_VERSION: u8 = 0x01;
pub const POLICY_UP_REQUIRED: u8 = 0x01;
pub const PIN_MIN: usize = 6;
pub const PIN_MAX: usize = 63;
pub const NONCE_LEN: usize = 32;
pub const DEVICE_ID_LEN: usize = 16;
pub const PUBKEY_LEN: usize = 65;
/// Maximum length of a DER ECDSA P-256 signature.
pub const SIG_DER_MAX: usize = 72;
pub const TRANSCRIPT_PREFIX: &[u8; 10] = b"MKAUTH-v1\0";

/// Status word returned by the applet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusWord {
    Ok,
    /// 6300: no button press in time.
    NoUserPresence,
    /// 63Cx: PIN wrong, `x` tries left.
    RetriesLeft(u8),
    /// 6700
    WrongLength,
    /// 6982
    PinFailed,
    /// 6983
    PinBlocked,
    /// 6985
    WrongState,
    /// 6A80: invalid data (e.g. an invalid device name, or a PIN sent to an unenrolled device).
    WrongData,
    /// 6A86
    BadP1P2,
    /// 6D00
    UnknownIns,
    /// 6E00
    UnknownCla,
    /// 6F00
    Internal,
    Other(u16),
}

impl From<u16> for StatusWord {
    fn from(sw: u16) -> Self {
        match sw {
            0x9000 => Self::Ok,
            0x6300 => Self::NoUserPresence,
            0x63C0..=0x63CF => Self::RetriesLeft((sw & 0x0F) as u8),
            0x6700 => Self::WrongLength,
            0x6982 => Self::PinFailed,
            0x6983 => Self::PinBlocked,
            0x6985 => Self::WrongState,
            0x6A86 => Self::BadP1P2,
            0x6A80 => Self::WrongData,
            0x6D00 => Self::UnknownIns,
            0x6E00 => Self::UnknownCla,
            0x6F00 => Self::Internal,
            other => Self::Other(other),
        }
    }
}

impl From<StatusWord> for u16 {
    fn from(sw: StatusWord) -> u16 {
        match sw {
            StatusWord::Ok => 0x9000,
            StatusWord::NoUserPresence => 0x6300,
            StatusWord::RetriesLeft(n) => 0x63C0 | u16::from(n & 0x0F),
            StatusWord::WrongLength => 0x6700,
            StatusWord::PinFailed => 0x6982,
            StatusWord::PinBlocked => 0x6983,
            StatusWord::WrongState => 0x6985,
            StatusWord::BadP1P2 => 0x6A86,
            StatusWord::WrongData => 0x6A80,
            StatusWord::UnknownIns => 0x6D00,
            StatusWord::UnknownCla => 0x6E00,
            StatusWord::Internal => 0x6F00,
            StatusWord::Other(v) => v,
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProtoError {
    #[error("PIN length {0} outside {PIN_MIN}..={PIN_MAX} bytes")]
    PinLength(usize),
    #[error("response too short to contain a status word")]
    NoStatusWord,
    #[error("malformed {what}: {len} bytes")]
    BadLength { what: &'static str, len: usize },
    #[error("unsupported protocol version {0:#04x}")]
    BadVersion(u8),
    #[error("invalid state byte {0:#04x}")]
    BadState(u8),
    #[error("invalid device name: {0}")]
    Name(#[from] NameError),
    #[error("policy {0:#04x} does not require user presence (bit0 must be set)")]
    PolicyNoPresence(u8),
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum VerifyError {
    #[error("public key is not a valid uncompressed P-256 point")]
    BadPublicKey,
    #[error("signature is not canonical DER or is oversized")]
    BadSignatureEncoding,
    #[error("signature verification failed")]
    BadSignature,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Info {
    pub version: u8,
    pub enrolled: bool,
    pub policy: u8,
    pub device_id: [u8; DEVICE_ID_LEN],
    pub pubkey: Option<[u8; PUBKEY_LEN]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Enrollment {
    pub pubkey: [u8; PUBKEY_LEN],
    pub device_id: [u8; DEVICE_ID_LEN],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Challenge {
    pub device_nonce: [u8; NONCE_LEN],
    pub signature_der: Vec<u8>,
}

/// `00 A4 04 00 08 AID`
pub fn select_apdu() -> Vec<u8> {
    let mut v = vec![0x00, 0xA4, 0x04, 0x00, AID.len() as u8];
    v.extend_from_slice(&AID);
    v
}

/// `80 01 00 00 00` (Le = 0 requests the full response).
pub fn get_info_apdu() -> Vec<u8> {
    vec![CLA, INS_GET_INFO, 0, 0, 0x00]
}

fn check_pin(pin: &[u8]) -> Result<(), ProtoError> {
    if (PIN_MIN..=PIN_MAX).contains(&pin.len()) {
        Ok(())
    } else {
        Err(ProtoError::PinLength(pin.len()))
    }
}

/// `80 02 00 00 Lc PIN 00`
pub fn enroll_apdu(pin: &[u8]) -> Result<Vec<u8>, ProtoError> {
    check_pin(pin)?;
    let mut v = vec![CLA, INS_ENROLL, 0, 0, pin.len() as u8];
    v.extend_from_slice(pin);
    v.push(0x00);
    Ok(v)
}

/// `80 03 00 00 20 host_nonce 00`
pub fn challenge_apdu(host_nonce: &[u8; NONCE_LEN]) -> Vec<u8> {
    let mut v = vec![CLA, INS_CHALLENGE, 0, 0, NONCE_LEN as u8];
    v.extend_from_slice(host_nonce);
    v.push(0x00);
    v
}

/// `80 04 00 00 Lc PIN` (no response data, no Le).
pub fn revoke_apdu(pin: &[u8]) -> Result<Vec<u8>, ProtoError> {
    check_pin(pin)?;
    let mut v = vec![CLA, INS_REVOKE, 0, 0, pin.len() as u8];
    v.extend_from_slice(pin);
    Ok(v)
}

/// Why a device name was rejected. The firmware applies the same rules (`multikey_name_valid`).
#[derive(Debug, Error, PartialEq, Eq)]
pub enum NameError {
    #[error("name is empty")]
    Empty,
    #[error("name is {0} bytes, the limit is {NAME_MAX}")]
    TooLong(usize),
    #[error("{0:?} cannot be used: the USB stack of this firmware only represents printable ASCII (0x20..0x7E)")]
    NotPrintableAscii(char),
    #[error("name must not start or end with a space")]
    EdgeSpace,
}

/// Checks `name` against the firmware rules: 1..=31 printable ASCII characters (esp_tinyusb converts string
/// descriptors byte for byte, so anything else would be corrupted on the wire), no leading/trailing space.
/// `name` is already valid UTF-8 (`&str`); non-ASCII text is refused rather than transcoded.
pub fn validate_device_name(name: &str) -> Result<(), NameError> {
    if name.is_empty() {
        return Err(NameError::Empty);
    }
    if name.len() > NAME_MAX {
        return Err(NameError::TooLong(name.len()));
    }
    if let Some(c) = name.chars().find(|c| !(' '..='~').contains(c)) {
        return Err(NameError::NotPrintableAscii(c));
    }
    if name.starts_with(' ') || name.ends_with(' ') {
        return Err(NameError::EdgeSpace);
    }
    Ok(())
}

/// PIN field of a management command: empty while the device is not enrolled, otherwise a valid PIN.
fn manage_pin(pin: &[u8]) -> Result<(), ProtoError> {
    if pin.is_empty() {
        Ok(())
    } else {
        check_pin(pin)
    }
}

fn name_apdu(p1: u8, p2: u8, pin: &[u8], name: &[u8], le: bool) -> Result<Vec<u8>, ProtoError> {
    manage_pin(pin)?;
    let mut v = vec![
        CLA,
        INS_DEVICE_NAME,
        p1,
        p2,
        (1 + pin.len() + name.len()) as u8,
        pin.len() as u8,
    ];
    v.extend_from_slice(pin);
    v.extend_from_slice(name);
    if le {
        v.push(0x00);
    }
    Ok(v)
}

/// `80 06 00 00 00`: read the device name (no authorization needed).
pub fn device_name_get_apdu() -> Vec<u8> {
    vec![CLA, INS_DEVICE_NAME, NAME_GET, 0, 0x00]
}

/// `80 06 01 P2 Lc pin_len PIN name 00`. `pin` is empty while the device is not enrolled. With
/// `reenumerate` (P2 = 01) the device also detaches/attaches USB after answering.
pub fn device_name_set_apdu(
    pin: &[u8],
    name: &str,
    reenumerate: bool,
) -> Result<Vec<u8>, ProtoError> {
    validate_device_name(name)?;
    name_apdu(NAME_SET, u8::from(reenumerate), pin, name.as_bytes(), true)
}

/// `80 06 02 P2 Lc pin_len PIN 00`: restore the default (Kconfig) name.
pub fn device_name_clear_apdu(pin: &[u8], reenumerate: bool) -> Result<Vec<u8>, ProtoError> {
    name_apdu(NAME_CLEAR, u8::from(reenumerate), pin, &[], true)
}

/// `80 06 03 00 Lc pin_len PIN`: detach from USB briefly so the host re-reads the descriptors.
pub fn device_name_reenumerate_apdu(pin: &[u8]) -> Result<Vec<u8>, ProtoError> {
    name_apdu(NAME_REENUM, 0, pin, &[], false)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceName {
    /// A user-chosen name is stored (otherwise `name` is the build-time default).
    pub custom: bool,
    /// The stored name differs from the one currently enumerated: unplug/replug or `reenumerate`.
    pub reenumeration_pending: bool,
    /// The firmware was built with renaming enabled.
    pub rename_supported: bool,
    /// The name the next enumeration will report.
    pub name: String,
}

pub fn parse_device_name(data: &[u8]) -> Result<DeviceName, ProtoError> {
    let bad = || ProtoError::BadLength {
        what: "device name response",
        len: data.len(),
    };
    if data.len() < 2 || data.len() > 1 + NAME_MAX || data[0] & !0x07 != 0 {
        return Err(bad());
    }
    let name = std::str::from_utf8(&data[1..]).map_err(|_| bad())?;
    if !name.bytes().all(|b| (0x20..=0x7E).contains(&b)) {
        return Err(bad());
    }
    Ok(DeviceName {
        custom: data[0] & 0x01 != 0,
        reenumeration_pending: data[0] & 0x02 != 0,
        rename_supported: data[0] & 0x04 != 0,
        name: name.to_owned(),
    })
}

/// Tags of the `INS 07` BUILD_INFO response entries (`docs/PROTOCOLS.md`).
pub mod build_tag {
    pub const PROJECT: u8 = 0x01;
    pub const VERSION: u8 = 0x02;
    pub const IDF: u8 = 0x03;
    pub const COMMIT: u8 = 0x04;
    pub const IMAGE_SHA256: u8 = 0x05;
    pub const ELF_SHA256: u8 = 0x06;
    pub const FLASH_BUILT: u8 = 0x07;
    pub const FLASH_CHIP: u8 = 0x08;
    pub const SECURITY: u8 = 0x09;
    pub const CHIP: u8 = 0x0A;
    pub const RESET: u8 = 0x0B;
    pub const UPTIME: u8 = 0x0C;
    pub const PARTITION: u8 = 0x0D;
}

/// What the running firmware reports about itself (`INS 07`, read-only, no button, no PIN). A field is `None`
/// when the firmware did not send it (a newer or older build); unknown tags are skipped.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BuildInfo {
    pub project: Option<String>,
    pub version: Option<String>,
    pub idf_version: Option<String>,
    /// Source commit the firmware was built from: 12 hex digits, `+dirty` when tracked files were modified, or
    /// `unknown`.
    pub commit: Option<String>,
    /// SHA-256 of the app image as flashed: equals `images[role=app].sha256` of the release manifest.
    pub image_sha256: Option<[u8; 32]>,
    pub elf_sha256: Option<[u8; 32]>,
    /// Flash size the image was built for, e.g. `16MB`.
    pub flash_built_for: Option<String>,
    /// Flash size the chip reports, in bytes.
    pub flash_chip_bytes: Option<u32>,
    pub flash_encryption: Option<bool>,
    pub secure_boot: Option<bool>,
    /// `esp_chip_model_t`.
    pub chip_model: Option<u8>,
    /// Full chip revision, `major * 100 + minor`.
    pub chip_revision: Option<u16>,
    pub chip_cores: Option<u8>,
    /// `esp_reset_reason_t` of this boot.
    pub reset_reason: Option<u8>,
    pub uptime_seconds: Option<u32>,
    pub partition_offset: Option<u32>,
    pub partition_label: Option<String>,
}

/// `80 07 00 00 00`: read what the firmware is (no authorization needed).
pub fn build_info_apdu() -> Vec<u8> {
    vec![CLA, INS_BUILD_INFO, 0, 0, 0x00]
}

/// Parses a BUILD_INFO response (`fmt(1)=01` then `tag | len | value` entries). Text is accepted only as printable
/// ASCII, so nothing a device sends can inject control characters into a terminal or a report.
pub fn parse_build_info(data: &[u8]) -> Result<BuildInfo, ProtoError> {
    let bad = |what: &'static str| ProtoError::BadLength {
        what,
        len: data.len(),
    };
    match data.first() {
        Some(&BUILD_INFO_FORMAT) => {}
        Some(&v) => return Err(ProtoError::BadVersion(v)),
        None => return Err(bad("build info")),
    }
    let text = |v: &[u8]| -> Result<String, ProtoError> {
        if v.iter().all(|b| (0x20..=0x7E).contains(b)) {
            Ok(String::from_utf8_lossy(v).into_owned())
        } else {
            Err(bad("build info (text is not printable ASCII)"))
        }
    };
    let fixed = |v: &[u8], n: usize| -> Result<(), ProtoError> {
        if v.len() == n {
            Ok(())
        } else {
            Err(bad("build info (entry has the wrong length)"))
        }
    };
    let be32 = |v: &[u8]| u32::from_be_bytes([v[0], v[1], v[2], v[3]]);
    let mut info = BuildInfo::default();
    let mut seen = 0u32;
    let mut rest = &data[1..];
    while !rest.is_empty() {
        let (Some(&tag), Some(&len)) = (rest.first(), rest.get(1)) else {
            return Err(bad("build info (truncated entry)"));
        };
        let Some(v) = rest.get(2..2 + usize::from(len)) else {
            return Err(bad("build info (truncated entry)"));
        };
        rest = &rest[2 + usize::from(len)..];
        if tag < 32 {
            if seen & (1 << tag) != 0 {
                return Err(bad("build info (repeated entry)"));
            }
            seen |= 1 << tag;
        }
        match tag {
            build_tag::PROJECT => info.project = Some(text(v)?),
            build_tag::VERSION => info.version = Some(text(v)?),
            build_tag::IDF => info.idf_version = Some(text(v)?),
            build_tag::COMMIT => info.commit = Some(text(v)?),
            build_tag::IMAGE_SHA256 => {
                fixed(v, 32)?;
                info.image_sha256 = Some(arr(v));
            }
            build_tag::ELF_SHA256 => {
                fixed(v, 32)?;
                info.elf_sha256 = Some(arr(v));
            }
            build_tag::FLASH_BUILT => info.flash_built_for = Some(text(v)?),
            build_tag::FLASH_CHIP => {
                fixed(v, 4)?;
                info.flash_chip_bytes = Some(be32(v));
            }
            build_tag::SECURITY => {
                fixed(v, 1)?;
                info.flash_encryption = Some(v[0] & 0x01 != 0);
                info.secure_boot = Some(v[0] & 0x02 != 0);
            }
            build_tag::CHIP => {
                fixed(v, 4)?;
                info.chip_model = Some(v[0]);
                info.chip_revision = Some(u16::from_be_bytes([v[1], v[2]]));
                info.chip_cores = Some(v[3]);
            }
            build_tag::RESET => {
                fixed(v, 1)?;
                info.reset_reason = Some(v[0]);
            }
            build_tag::UPTIME => {
                fixed(v, 4)?;
                info.uptime_seconds = Some(be32(v));
            }
            build_tag::PARTITION => {
                if v.len() < 4 {
                    return Err(bad("build info (entry has the wrong length)"));
                }
                info.partition_offset = Some(be32(v));
                info.partition_label = Some(text(&v[4..])?);
            }
            _ => {} // a tag from a newer firmware
        }
    }
    Ok(info)
}

/// Name of an `esp_chip_model_t` value.
pub fn chip_model_name(model: u8) -> Option<&'static str> {
    Some(match model {
        1 => "ESP32",
        2 => "ESP32-S2",
        5 => "ESP32-C3",
        9 => "ESP32-S3",
        12 => "ESP32-C2",
        13 => "ESP32-C6",
        16 => "ESP32-H2",
        18 => "ESP32-P4",
        _ => return None,
    })
}

/// Name of an `esp_reset_reason_t` value.
pub fn reset_reason_name(reason: u8) -> Option<&'static str> {
    Some(match reason {
        0 => "unknown",
        1 => "power-on",
        2 => "external pin",
        3 => "software restart",
        4 => "panic",
        5 => "interrupt watchdog",
        6 => "task watchdog",
        7 => "other watchdog",
        8 => "deep sleep wake-up",
        9 => "brownout",
        10 => "SDIO",
        11 => "USB",
        12 => "JTAG",
        13 => "eFuse error",
        14 => "power glitch",
        15 => "CPU lock-up",
        _ => return None,
    })
}

/// Split a raw card response into (data, status word).
pub fn split_response(resp: &[u8]) -> Result<(&[u8], StatusWord), ProtoError> {
    if resp.len() < 2 {
        return Err(ProtoError::NoStatusWord);
    }
    let (data, sw) = resp.split_at(resp.len() - 2);
    Ok((data, StatusWord::from(u16::from_be_bytes([sw[0], sw[1]]))))
}

fn arr<const N: usize>(b: &[u8]) -> [u8; N] {
    let mut a = [0u8; N];
    a.copy_from_slice(b);
    a
}

pub fn parse_info(data: &[u8]) -> Result<Info, ProtoError> {
    let bad = || ProtoError::BadLength {
        what: "info",
        len: data.len(),
    };
    if data.len() < 3 + DEVICE_ID_LEN {
        return Err(bad());
    }
    let version = data[0];
    if version != PROTOCOL_VERSION {
        return Err(ProtoError::BadVersion(version));
    }
    let enrolled = match data[1] {
        0 => false,
        1 => true,
        s => return Err(ProtoError::BadState(s)),
    };
    let expected = 3 + DEVICE_ID_LEN + if enrolled { PUBKEY_LEN } else { 0 };
    if data.len() != expected {
        return Err(bad());
    }
    if data[2] & 0x01 == 0 {
        return Err(ProtoError::PolicyNoPresence(data[2]));
    }
    Ok(Info {
        version,
        enrolled,
        policy: data[2],
        device_id: arr(&data[3..3 + DEVICE_ID_LEN]),
        pubkey: enrolled.then(|| arr(&data[3 + DEVICE_ID_LEN..])),
    })
}

pub fn parse_enroll(data: &[u8]) -> Result<Enrollment, ProtoError> {
    if data.len() != PUBKEY_LEN + DEVICE_ID_LEN {
        return Err(ProtoError::BadLength {
            what: "enroll response",
            len: data.len(),
        });
    }
    Ok(Enrollment {
        pubkey: arr(&data[..PUBKEY_LEN]),
        device_id: arr(&data[PUBKEY_LEN..]),
    })
}

pub fn parse_challenge(data: &[u8]) -> Result<Challenge, ProtoError> {
    // A DER ECDSA signature is at least 8 bytes (30 06 02 01 r 02 01 s).
    if data.len() < NONCE_LEN + 8 || data.len() > NONCE_LEN + SIG_DER_MAX {
        return Err(ProtoError::BadLength {
            what: "challenge response",
            len: data.len(),
        });
    }
    Ok(Challenge {
        device_nonce: arr(&data[..NONCE_LEN]),
        signature_der: data[NONCE_LEN..].to_vec(),
    })
}

/// `"MKAUTH-v1\0" ‖ host_nonce ‖ device_nonce ‖ device_id`
pub fn transcript(
    host_nonce: &[u8; NONCE_LEN],
    device_nonce: &[u8; NONCE_LEN],
    device_id: &[u8; DEVICE_ID_LEN],
) -> Vec<u8> {
    let mut v = Vec::with_capacity(TRANSCRIPT_PREFIX.len() + 2 * NONCE_LEN + DEVICE_ID_LEN);
    v.extend_from_slice(TRANSCRIPT_PREFIX);
    v.extend_from_slice(host_nonce);
    v.extend_from_slice(device_nonce);
    v.extend_from_slice(device_id);
    v
}

/// Verify an ECDSA P-256 / SHA-256 DER signature over `transcript`.
pub fn verify(
    pubkey: &[u8; PUBKEY_LEN],
    transcript: &[u8],
    sig_der: &[u8],
) -> Result<(), VerifyError> {
    if pubkey[0] != 0x04 {
        return Err(VerifyError::BadPublicKey);
    }
    let key = VerifyingKey::from_sec1_bytes(pubkey).map_err(|_| VerifyError::BadPublicKey)?;
    if sig_der.len() > SIG_DER_MAX {
        return Err(VerifyError::BadSignatureEncoding);
    }
    let sig = Signature::from_der(sig_der).map_err(|_| VerifyError::BadSignatureEncoding)?;
    // Reject non-canonical DER (e.g. padded integers, trailing data).
    if sig.to_der().as_bytes() != sig_der {
        return Err(VerifyError::BadSignatureEncoding);
    }
    key.verify(transcript, &sig)
        .map_err(|_| VerifyError::BadSignature)
}

/// Fixed, publicly known key for tests. TEST ONLY.
#[cfg(feature = "test-key")]
pub mod testkey {
    use super::*;
    use p256::ecdsa::{signature::Signer, SigningKey};

    /// TEST ONLY private scalar: bytes 0x01..=0x20.
    pub const TEST_PRIVATE_KEY: [u8; 32] = [
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F,
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E,
        0x1F, 0x20,
    ];
    /// TEST ONLY device id.
    pub const TEST_DEVICE_ID: [u8; 16] = [
        0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE,
        0xDF,
    ];

    pub fn signing_key() -> SigningKey {
        SigningKey::from_slice(&TEST_PRIVATE_KEY).expect("valid test scalar")
    }

    pub fn public_key() -> [u8; PUBKEY_LEN] {
        let p = signing_key().verifying_key().to_encoded_point(false);
        arr(p.as_bytes())
    }

    /// Deterministic (RFC 6979) DER signature over `msg`.
    pub fn sign(msg: &[u8]) -> Vec<u8> {
        let s: Signature = signing_key().sign(msg);
        s.to_der().as_bytes().to_vec()
    }
}
