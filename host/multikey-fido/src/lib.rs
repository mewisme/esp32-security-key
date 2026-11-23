//! FIDO2/CTAP2 management for the `multikey` tool: authenticatorGetInfo, ClientPIN status/set/change and
//! credential management (list/delete discoverable credentials).
//!
//! The CTAP2 transport and PIN-protocol cryptography are delegated to the `ctap-hid-fido2` crate (pinned);
//! this crate only adds a small [`Authenticator`] trait (so the CLI is testable with [`mock::MockAuthenticator`]),
//! status classification and the safety rules (never set a PIN that exists, verify after every mutation).
//!
//! PINs are plain `&str` parameters. Nothing here logs, formats or stores them and no error type carries one.

use std::collections::BTreeMap;

use serde::Serialize;

mod hid;
pub mod mock;

pub use hid::{list_devices, HidAuthenticator};

/// Longest PIN CTAP2 allows, in bytes (CTAP 2.1 section 6.5.4: 63 bytes UTF-8).
pub const MAX_PIN_BYTES: usize = 63;
/// Minimum PIN length in code points when the authenticator does not report `minPINLength`.
pub const DEFAULT_MIN_PIN: u32 = 4;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HidDevice {
    /// Position in the enumeration order of [`list_devices`] (unstable across replugs).
    pub index: usize,
    pub path: String,
    pub vid: u16,
    pub pid: u16,
    pub product: String,
    pub serial: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FidoInfo {
    pub versions: Vec<String>,
    /// 32 hex digits.
    pub aaguid: String,
    /// authenticatorGetInfo firmwareVersion. For this firmware that is the upstream pico-fido core version,
    /// not a MultiKeys build identifier.
    pub firmware_version: Option<u32>,
    pub options: BTreeMap<String, bool>,
    pub extensions: Vec<String>,
    pub pin_protocols: Vec<u32>,
    pub min_pin_length: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PinState {
    Unsupported,
    NotSet,
    Set,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PinStatus {
    pub client_pin: PinState,
    /// Only known when a PIN is set.
    pub retries: Option<u32>,
    pub always_uv: Option<bool>,
    pub make_cred_uv_not_rqd: Option<bool>,
    pub cred_mgmt: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CredEntry {
    pub rp_id: String,
    /// Credential ID, lower-case hex.
    pub credential_id: String,
    pub user_name: String,
    pub user_display_name: String,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FidoError {
    #[error("no FIDO HID device found")]
    NoDevice,
    #[error("several FIDO HID devices found; choose one with --hid-path or --device")]
    Ambiguous,
    #[error("not supported by this authenticator: {0}")]
    Unsupported(&'static str),
    #[error("no FIDO PIN is set")]
    PinNotSet,
    #[error("wrong PIN{}", .retries.map(|r| format!(" ({r} attempts left before the PIN is blocked)")).unwrap_or_default())]
    PinInvalid { retries: Option<u32> },
    #[error(
        "the PIN is blocked; only authenticatorReset (which deletes every credential) clears it"
    )]
    PinBlocked,
    #[error(
        "PIN entry is temporarily blocked after too many wrong attempts; unplug and replug the key"
    )]
    PinAuthBlocked,
    #[error("PIN rejected: {0}")]
    PinPolicy(String),
    #[error("user presence timed out or was denied")]
    NoUserPresence,
    #[error("cancelled")]
    Cancelled,
    #[error("credential not found")]
    NotFound,
    #[error("transport error: {0}")]
    Transport(String),
    #[error("{0}")]
    Other(String),
}

pub trait Authenticator {
    fn info(&self) -> Result<FidoInfo, FidoError>;
    fn pin_status(&self) -> Result<PinStatus, FidoError>;
    fn set_pin(&self, new_pin: &str) -> Result<(), FidoError>;
    fn change_pin(&self, current: &str, new: &str) -> Result<(), FidoError>;
    fn list_credentials(&self, pin: &str) -> Result<Vec<CredEntry>, FidoError>;
    fn delete_credential(&self, pin: &str, credential_id_hex: &str) -> Result<(), FidoError>;
}

/// Derive the PIN state from the authenticatorGetInfo options.
pub fn pin_status_from_options(
    options: &BTreeMap<String, bool>,
    retries: Option<u32>,
) -> PinStatus {
    let client_pin = match options.get("clientPin") {
        None => PinState::Unsupported,
        Some(false) => PinState::NotSet,
        Some(true) => PinState::Set,
    };
    PinStatus {
        client_pin,
        retries: if client_pin == PinState::Set {
            retries
        } else {
            None
        },
        always_uv: options.get("alwaysUv").copied(),
        make_cred_uv_not_rqd: options.get("makeCredUvNotRqd").copied(),
        cred_mgmt: options.get("credMgmt").copied().unwrap_or(false)
            || options
                .get("credentialMgmtPreview")
                .copied()
                .unwrap_or(false),
    }
}

/// Validate a new PIN before anything is sent. `min` is the authenticator's `minPINLength` (code points).
pub fn validate_new_pin(pin: &str, min: Option<u32>) -> Result<(), FidoError> {
    let min = min.unwrap_or(DEFAULT_MIN_PIN) as usize;
    if pin.chars().count() < min {
        return Err(FidoError::PinPolicy(format!(
            "must be at least {min} characters"
        )));
    }
    if pin.len() > MAX_PIN_BYTES {
        return Err(FidoError::PinPolicy(format!(
            "must be at most {MAX_PIN_BYTES} bytes"
        )));
    }
    Ok(())
}

/// Map the text of an error from the transport crate onto [`FidoError`]. The crate reports CTAP status
/// codes as `response_status err = 0xNN CTAP2_ERR_NAME ...`.
pub fn classify_error(msg: &str) -> FidoError {
    let table: [(&str, FidoError); 8] = [
        (
            "CTAP2_ERR_PIN_INVALID",
            FidoError::PinInvalid { retries: None },
        ),
        ("CTAP2_ERR_PIN_BLOCKED", FidoError::PinBlocked),
        ("CTAP2_ERR_PIN_AUTH_BLOCKED", FidoError::PinAuthBlocked),
        ("CTAP2_ERR_PIN_NOT_SET", FidoError::PinNotSet),
        ("CTAP2_ERR_OPERATION_DENIED", FidoError::NoUserPresence),
        ("CTAP2_ERR_USER_ACTION_TIMEOUT", FidoError::NoUserPresence),
        ("CTAP2_ERR_KEEPALIVE_CANCEL", FidoError::Cancelled),
        ("CTAP2_ERR_NO_CREDENTIALS", FidoError::NotFound),
    ];
    // Longer names first so PIN_AUTH_BLOCKED is not shadowed by a shorter match.
    if msg.contains("CTAP2_ERR_PIN_AUTH_BLOCKED") {
        return FidoError::PinAuthBlocked;
    }
    for (name, err) in table {
        if msg.contains(name) {
            return err;
        }
    }
    if msg.contains("CTAP2_ERR_PIN_POLICY_VIOLATION") {
        return FidoError::PinPolicy("the authenticator's PIN policy rejected it".into());
    }
    if msg.contains("CTAP2_ERR_UNSUPPORTED_OPTION") {
        return FidoError::Unsupported("option or command");
    }
    if msg.contains("FIDO device not found") {
        return FidoError::NoDevice;
    }
    if msg.contains("Failed to open device")
        || msg.contains("read error")
        || msg.contains("write error")
    {
        return FidoError::Transport(msg.to_string());
    }
    FidoError::Other(msg.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(pairs: &[(&str, bool)]) -> BTreeMap<String, bool> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn client_pin_option_maps_to_state() {
        assert_eq!(
            pin_status_from_options(&opts(&[]), Some(8)).client_pin,
            PinState::Unsupported
        );
        assert_eq!(
            pin_status_from_options(&opts(&[("clientPin", false)]), Some(8)).client_pin,
            PinState::NotSet
        );
        let s = pin_status_from_options(&opts(&[("clientPin", true)]), Some(8));
        assert_eq!(s.client_pin, PinState::Set);
        assert_eq!(s.retries, Some(8));
    }

    #[test]
    fn retries_hidden_unless_pin_set() {
        let s = pin_status_from_options(&opts(&[("clientPin", false)]), Some(8));
        assert_eq!(s.retries, None);
    }

    #[test]
    fn cred_mgmt_detected_from_either_option() {
        assert!(pin_status_from_options(&opts(&[("credMgmt", true)]), None).cred_mgmt);
        assert!(pin_status_from_options(&opts(&[("credentialMgmtPreview", true)]), None).cred_mgmt);
        assert!(!pin_status_from_options(&opts(&[("credMgmt", false)]), None).cred_mgmt);
    }

    #[test]
    fn pin_length_rules() {
        assert!(validate_new_pin("123", None).is_err());
        assert!(validate_new_pin("1234", None).is_ok());
        assert!(validate_new_pin("123456", Some(6)).is_ok());
        assert!(validate_new_pin("12345", Some(6)).is_err());
        assert!(validate_new_pin(&"x".repeat(64), None).is_err());
        assert!(validate_new_pin(&"x".repeat(63), None).is_ok());
        // minimum counts characters, maximum counts bytes
        assert!(validate_new_pin("\u{00e9}\u{00e9}\u{00e9}\u{00e9}", None).is_ok());
    }

    #[test]
    fn status_text_classification() {
        let m = |name: &str| format!("response_status err = 0x31 {name} message");
        assert_eq!(
            classify_error(&m("CTAP2_ERR_PIN_INVALID")),
            FidoError::PinInvalid { retries: None }
        );
        assert_eq!(
            classify_error(&m("CTAP2_ERR_PIN_BLOCKED")),
            FidoError::PinBlocked
        );
        assert_eq!(
            classify_error(&m("CTAP2_ERR_PIN_AUTH_BLOCKED")),
            FidoError::PinAuthBlocked
        );
        assert_eq!(
            classify_error(&m("CTAP2_ERR_PIN_NOT_SET")),
            FidoError::PinNotSet
        );
        assert_eq!(
            classify_error(&m("CTAP2_ERR_OPERATION_DENIED")),
            FidoError::NoUserPresence
        );
        assert_eq!(
            classify_error(&m("CTAP2_ERR_USER_ACTION_TIMEOUT")),
            FidoError::NoUserPresence
        );
        assert_eq!(
            classify_error(&m("CTAP2_ERR_KEEPALIVE_CANCEL")),
            FidoError::Cancelled
        );
        assert!(matches!(
            classify_error(&m("CTAP2_ERR_PIN_POLICY_VIOLATION")),
            FidoError::PinPolicy(_)
        ));
        assert!(matches!(
            classify_error(&m("CTAP2_ERR_UNSUPPORTED_OPTION")),
            FidoError::Unsupported(_)
        ));
        assert_eq!(
            classify_error("FIDO device not found."),
            FidoError::NoDevice
        );
        assert!(matches!(
            classify_error("read error"),
            FidoError::Transport(_)
        ));
        assert!(matches!(
            classify_error("something else"),
            FidoError::Other(_)
        ));
    }

    #[test]
    fn errors_never_contain_secrets_shape() {
        // PinInvalid carries only the retry counter.
        let e = FidoError::PinInvalid { retries: Some(5) };
        assert_eq!(
            e.to_string(),
            "wrong PIN (5 attempts left before the PIN is blocked)"
        );
    }
}
