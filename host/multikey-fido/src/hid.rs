//! Real authenticator over USB HID, backed by `ctap-hid-fido2`.

use std::collections::BTreeMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

use ctap_hid_fido2::public_key_credential_descriptor::PublicKeyCredentialDescriptor;
use ctap_hid_fido2::{FidoKeyHid, HidInfo, HidParam, LibCfg};

use crate::{
    classify_error, pin_status_from_options, validate_new_pin, Authenticator, CredEntry, FidoError,
    FidoInfo, HidDevice, PinState, PinStatus,
};

fn guarded<T>(f: impl FnOnce() -> T) -> Result<T, FidoError> {
    // hidapi initialisation inside the transport crate uses expect(); turn a panic into an error.
    catch_unwind(AssertUnwindSafe(f))
        .map_err(|_| FidoError::Transport("HID subsystem unavailable".into()))
}

fn serial_of(info: &HidInfo) -> Option<String> {
    // The crate only exposes the serial inside its human-readable `info` string.
    info.info
        .split(" path=")
        .next()?
        .split(" serial_number=")
        .nth(1)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn path_of(info: &HidInfo) -> Option<String> {
    match &info.param {
        HidParam::Path(p) => Some(p.clone()),
        HidParam::VidPid { .. } => None,
    }
}

/// FIDO HID interfaces (usage page 0xF1D0) in enumeration order. Devices whose OS path cannot be
/// represented as text are skipped because they cannot be opened unambiguously.
pub fn list_devices() -> Vec<HidDevice> {
    let found = guarded(ctap_hid_fido2::get_fidokey_devices).unwrap_or_default();
    found
        .iter()
        .filter_map(|d| {
            Some((
                path_of(d)?,
                d.vid,
                d.pid,
                d.product_string.clone(),
                serial_of(d),
            ))
        })
        .enumerate()
        .map(|(index, (path, vid, pid, product, serial))| HidDevice {
            index,
            path,
            vid,
            pid,
            product,
            serial,
        })
        .collect()
}

pub struct HidAuthenticator {
    key: FidoKeyHid,
}

impl HidAuthenticator {
    /// Open the HID interface with this OS path (as printed by `multikey device list`).
    pub fn open(path: &str) -> Result<Self, FidoError> {
        // Keep-alive prompts go to stderr so that --json output on stdout stays clean.
        let mut cfg = LibCfg::init().with_keep_alive_msg_to_stderr(true);
        cfg.keep_alive_msg = "Touch the key's button now...".to_string();
        let params = [HidParam::Path(path.to_string())];
        let mut key = guarded(|| FidoKeyHid::new(&params, &cfg))?
            .map_err(|e| classify_error(&e.to_string()))?;
        // The transport crate defaults to the 0x41 preview credential-management command; use the final
        // 0x0A command whenever the authenticator advertises credMgmt.
        let info = key.get_info().map_err(|e| classify_error(&e.to_string()))?;
        if info.options.iter().any(|(k, v)| k == "credMgmt" && *v) {
            key.use_pre_credential_management = false;
        }
        Ok(Self { key })
    }

    fn read(&self) -> Result<FidoInfo, FidoError> {
        let i = self
            .key
            .get_info()
            .map_err(|e| classify_error(&e.to_string()))?;
        Ok(FidoInfo {
            versions: i.versions.clone(),
            aaguid: i.aaguid.iter().map(|b| format!("{b:02x}")).collect(),
            firmware_version: (i.firmware_version != 0).then_some(i.firmware_version),
            options: i
                .options
                .iter()
                .cloned()
                .collect::<BTreeMap<String, bool>>(),
            extensions: i.extensions.clone(),
            pin_protocols: i.pin_uv_auth_protocols.clone(),
            min_pin_length: (i.min_pin_length != 0).then_some(i.min_pin_length),
        })
    }

    /// Classify a transport error; a wrong PIN additionally reports the remaining attempts.
    fn pin_error<E: ToString>(&self, e: E) -> FidoError {
        match classify_error(&e.to_string()) {
            FidoError::PinInvalid { .. } => FidoError::PinInvalid {
                retries: self.pin_status().ok().and_then(|s| s.retries),
            },
            other => other,
        }
    }
}

impl Authenticator for HidAuthenticator {
    fn info(&self) -> Result<FidoInfo, FidoError> {
        self.read()
    }

    fn pin_status(&self) -> Result<PinStatus, FidoError> {
        let info = self.read()?;
        let mut st = pin_status_from_options(&info.options, None);
        if st.client_pin == PinState::Set {
            let r = self
                .key
                .get_pin_retries()
                .map_err(|e| classify_error(&e.to_string()))?;
            st.retries = u32::try_from(r).ok();
        }
        Ok(st)
    }

    fn set_pin(&self, new_pin: &str) -> Result<(), FidoError> {
        let info = self.read()?;
        let st = pin_status_from_options(&info.options, None);
        match st.client_pin {
            PinState::Unsupported => return Err(FidoError::Unsupported("clientPin")),
            PinState::Set => {
                return Err(FidoError::PinPolicy(
                    "a PIN is already set; use change".into(),
                ))
            }
            PinState::NotSet => {}
        }
        validate_new_pin(new_pin, info.min_pin_length)?;
        self.key
            .set_new_pin(new_pin)
            .map_err(|e| classify_error(&e.to_string()))?;
        // Never report success without reading the state back.
        match self.pin_status()?.client_pin {
            PinState::Set => Ok(()),
            _ => Err(FidoError::Other(
                "PIN command returned success but clientPin is not set".into(),
            )),
        }
    }

    fn change_pin(&self, current: &str, new: &str) -> Result<(), FidoError> {
        let info = self.read()?;
        match pin_status_from_options(&info.options, None).client_pin {
            PinState::Unsupported => return Err(FidoError::Unsupported("clientPin")),
            PinState::NotSet => return Err(FidoError::PinNotSet),
            PinState::Set => {}
        }
        validate_new_pin(new, info.min_pin_length)?;
        self.key
            .change_pin(current, new)
            .map_err(|e| self.pin_error(e))
    }

    fn list_credentials(&self, pin: &str) -> Result<Vec<CredEntry>, FidoError> {
        let info = self.read()?;
        let st = pin_status_from_options(&info.options, None);
        match st.client_pin {
            PinState::Unsupported => return Err(FidoError::Unsupported("clientPin")),
            PinState::NotSet => return Err(FidoError::PinNotSet),
            PinState::Set => {}
        }
        if !st.cred_mgmt {
            return Err(FidoError::Unsupported("credential management"));
        }
        let key = &self.key;
        let mut out = Vec::new();
        let rps = key
            .credential_management_enumerate_rps(Some(pin))
            .map_err(|e| self.pin_error(e))?;
        for rp in rps {
            let creds = key
                .credential_management_enumerate_credentials(Some(pin), &rp.rpid_hash)
                .map_err(|e| self.pin_error(e))?;
            for c in creds {
                out.push(CredEntry {
                    rp_id: rp.public_key_credential_rp_entity.id.clone(),
                    credential_id: c
                        .public_key_credential_descriptor
                        .id
                        .iter()
                        .map(|b| format!("{b:02x}"))
                        .collect(),
                    user_name: c.public_key_credential_user_entity.name.clone(),
                    user_display_name: c.public_key_credential_user_entity.display_name.clone(),
                });
            }
        }
        Ok(out)
    }

    fn delete_credential(&self, pin: &str, credential_id_hex: &str) -> Result<(), FidoError> {
        let id = decode_hex(credential_id_hex)
            .ok_or_else(|| FidoError::PinPolicy("credential id is not hex".into()))?;
        let want = credential_id_hex.to_ascii_lowercase();
        let before = self.list_credentials(pin)?;
        if !before.iter().any(|c| c.credential_id == want) {
            return Err(FidoError::NotFound);
        }
        let pkcd = PublicKeyCredentialDescriptor {
            id,
            ctype: "public-key".to_string(),
        };
        self.key
            .credential_management_delete_credential(Some(pin), pkcd)
            .map_err(|e| self.pin_error(e))?;
        let after = self.list_credentials(pin)?;
        if after.iter().any(|c| c.credential_id == want) {
            return Err(FidoError::Other(
                "delete reported success but the credential is still present".into(),
            ));
        }
        Ok(())
    }
}

pub(crate) fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if s.is_empty() || s.len() & 1 == 1 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}
