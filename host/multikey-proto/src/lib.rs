//! MKAUTH v1 wire protocol (see `docs/PROTOCOLS.md`). Pure library: no I/O.

use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use thiserror::Error;

/// Applet identifier.
pub const AID: [u8; 8] = [0xF0, 0x4D, 0x4B, 0x41, 0x55, 0x54, 0x48, 0x01];
/// Expected SELECT response data.
pub const SELECT_RESPONSE: &[u8; 8] = b"MKAUTH 1";
pub const CLA: u8 = 0x80;
pub const INS_GET_INFO: u8 = 0x01;
pub const INS_ENROLL: u8 = 0x02;
pub const INS_CHALLENGE: u8 = 0x03;
pub const INS_REVOKE: u8 = 0x04;
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
