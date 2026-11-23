//! In-memory authenticator for tests (CLI and library). Mirrors the rules of [`crate::HidAuthenticator`]:
//! no PIN overwrite, length checks, retry counter, verify-after-mutate.

use std::cell::RefCell;
use std::collections::BTreeMap;

use crate::{
    pin_status_from_options, validate_new_pin, Authenticator, CredEntry, FidoError, FidoInfo,
    PinState, PinStatus,
};

pub struct MockState {
    pub pin: Option<String>,
    pub retries: u32,
    pub credentials: Vec<CredEntry>,
    pub client_pin_supported: bool,
    pub cred_mgmt: bool,
    pub min_pin_length: Option<u32>,
    /// Every PIN-bearing call, for tests that assert on call order.
    pub calls: Vec<&'static str>,
}

pub struct MockAuthenticator {
    pub state: RefCell<MockState>,
}

impl Default for MockAuthenticator {
    fn default() -> Self {
        Self {
            state: RefCell::new(MockState {
                pin: None,
                retries: 8,
                credentials: Vec::new(),
                client_pin_supported: true,
                cred_mgmt: true,
                min_pin_length: Some(4),
                calls: Vec::new(),
            }),
        }
    }
}

impl MockAuthenticator {
    pub fn with_pin(pin: &str) -> Self {
        let m = Self::default();
        m.state.borrow_mut().pin = Some(pin.to_string());
        m
    }

    fn options(&self) -> BTreeMap<String, bool> {
        let s = self.state.borrow();
        let mut o = BTreeMap::new();
        if s.client_pin_supported {
            o.insert("clientPin".to_string(), s.pin.is_some());
        }
        o.insert("makeCredUvNotRqd".to_string(), true);
        o.insert("alwaysUv".to_string(), false);
        if s.cred_mgmt {
            o.insert("credMgmt".to_string(), true);
        }
        o
    }

    fn check_pin(&self, pin: &str) -> Result<(), FidoError> {
        let mut s = self.state.borrow_mut();
        let Some(expected) = s.pin.clone() else {
            return Err(FidoError::PinNotSet);
        };
        if s.retries == 0 {
            return Err(FidoError::PinBlocked);
        }
        if pin != expected {
            s.retries -= 1;
            return Err(FidoError::PinInvalid {
                retries: Some(s.retries),
            });
        }
        s.retries = 8;
        Ok(())
    }
}

impl Authenticator for MockAuthenticator {
    fn info(&self) -> Result<FidoInfo, FidoError> {
        let s = self.state.borrow();
        let min = s.min_pin_length;
        drop(s);
        Ok(FidoInfo {
            versions: vec!["U2F_V2".into(), "FIDO_2_0".into(), "FIDO_2_1".into()],
            aaguid: "0a63b9948ba65e749e5a0f894cc35c4d".into(),
            firmware_version: Some(0x0809),
            options: self.options(),
            extensions: vec!["hmac-secret".into()],
            pin_protocols: vec![1, 2],
            min_pin_length: min,
        })
    }

    fn pin_status(&self) -> Result<PinStatus, FidoError> {
        let retries = Some(self.state.borrow().retries);
        Ok(pin_status_from_options(&self.options(), retries))
    }

    fn set_pin(&self, new_pin: &str) -> Result<(), FidoError> {
        self.state.borrow_mut().calls.push("set_pin");
        match self.pin_status()?.client_pin {
            PinState::Unsupported => return Err(FidoError::Unsupported("clientPin")),
            PinState::Set => {
                return Err(FidoError::PinPolicy(
                    "a PIN is already set; use change".into(),
                ))
            }
            PinState::NotSet => {}
        }
        validate_new_pin(new_pin, self.state.borrow().min_pin_length)?;
        self.state.borrow_mut().pin = Some(new_pin.to_string());
        Ok(())
    }

    fn change_pin(&self, current: &str, new: &str) -> Result<(), FidoError> {
        self.state.borrow_mut().calls.push("change_pin");
        match self.pin_status()?.client_pin {
            PinState::Unsupported => return Err(FidoError::Unsupported("clientPin")),
            PinState::NotSet => return Err(FidoError::PinNotSet),
            PinState::Set => {}
        }
        validate_new_pin(new, self.state.borrow().min_pin_length)?;
        self.check_pin(current)?;
        self.state.borrow_mut().pin = Some(new.to_string());
        Ok(())
    }

    fn list_credentials(&self, pin: &str) -> Result<Vec<CredEntry>, FidoError> {
        self.state.borrow_mut().calls.push("list_credentials");
        if !self.state.borrow().cred_mgmt {
            return Err(FidoError::Unsupported("credential management"));
        }
        self.check_pin(pin)?;
        Ok(self.state.borrow().credentials.clone())
    }

    fn delete_credential(&self, pin: &str, credential_id_hex: &str) -> Result<(), FidoError> {
        self.state.borrow_mut().calls.push("delete_credential");
        let want = credential_id_hex.to_ascii_lowercase();
        let before = self.list_credentials(pin)?;
        if !before.iter().any(|c| c.credential_id == want) {
            return Err(FidoError::NotFound);
        }
        self.state
            .borrow_mut()
            .credentials
            .retain(|c| c.credential_id != want);
        if self
            .list_credentials(pin)?
            .iter()
            .any(|c| c.credential_id == want)
        {
            return Err(FidoError::Other(
                "credential still present after delete".into(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cred(id: &str) -> CredEntry {
        CredEntry {
            rp_id: "example.org".into(),
            credential_id: id.into(),
            user_name: "alice".into(),
            user_display_name: "Alice".into(),
        }
    }

    #[test]
    fn set_pin_then_state_is_set() {
        let m = MockAuthenticator::default();
        assert_eq!(m.pin_status().unwrap().client_pin, PinState::NotSet);
        m.set_pin("1234").unwrap();
        assert_eq!(m.pin_status().unwrap().client_pin, PinState::Set);
    }

    #[test]
    fn set_pin_refused_when_already_set() {
        let m = MockAuthenticator::with_pin("1234");
        assert!(matches!(m.set_pin("5678"), Err(FidoError::PinPolicy(_))));
        assert_eq!(m.state.borrow().pin.as_deref(), Some("1234"));
    }

    #[test]
    fn set_pin_refused_when_too_short() {
        let m = MockAuthenticator::default();
        assert!(matches!(m.set_pin("123"), Err(FidoError::PinPolicy(_))));
        assert_eq!(m.pin_status().unwrap().client_pin, PinState::NotSet);
    }

    #[test]
    fn set_pin_refused_when_unsupported() {
        let m = MockAuthenticator::default();
        m.state.borrow_mut().client_pin_supported = false;
        assert_eq!(m.set_pin("1234"), Err(FidoError::Unsupported("clientPin")));
    }

    #[test]
    fn change_pin_wrong_pin_decrements_and_reports_retries() {
        let m = MockAuthenticator::with_pin("1234");
        assert_eq!(
            m.change_pin("0000", "5678"),
            Err(FidoError::PinInvalid { retries: Some(7) })
        );
        assert_eq!(
            m.change_pin("0000", "5678"),
            Err(FidoError::PinInvalid { retries: Some(6) })
        );
        assert_eq!(m.state.borrow().pin.as_deref(), Some("1234"));
        m.change_pin("1234", "5678").unwrap();
        assert_eq!(m.state.borrow().pin.as_deref(), Some("5678"));
    }

    #[test]
    fn change_pin_without_pin_is_pin_not_set() {
        let m = MockAuthenticator::default();
        assert_eq!(m.change_pin("1234", "5678"), Err(FidoError::PinNotSet));
    }

    #[test]
    fn delete_not_found() {
        let m = MockAuthenticator::with_pin("1234");
        m.state.borrow_mut().credentials.push(cred("aa"));
        assert_eq!(m.delete_credential("1234", "bb"), Err(FidoError::NotFound));
        assert_eq!(m.state.borrow().credentials.len(), 1);
    }

    #[test]
    fn delete_verifies_absence() {
        let m = MockAuthenticator::with_pin("1234");
        m.state.borrow_mut().credentials.push(cred("aa"));
        m.state.borrow_mut().credentials.push(cred("bb"));
        m.delete_credential("1234", "AA").unwrap();
        let left = m.list_credentials("1234").unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].credential_id, "bb");
    }

    #[test]
    fn list_without_pin_set_is_pin_not_set() {
        let m = MockAuthenticator::default();
        assert_eq!(m.list_credentials("1234"), Err(FidoError::PinNotSet));
    }

    #[test]
    fn list_unsupported_without_cred_mgmt() {
        let m = MockAuthenticator::with_pin("1234");
        m.state.borrow_mut().cred_mgmt = false;
        assert_eq!(
            m.list_credentials("1234"),
            Err(FidoError::Unsupported("credential management"))
        );
    }

    #[test]
    fn blocked_after_retries_exhausted() {
        let m = MockAuthenticator::with_pin("1234");
        m.state.borrow_mut().retries = 1;
        assert_eq!(
            m.change_pin("0000", "5678"),
            Err(FidoError::PinInvalid { retries: Some(0) })
        );
        assert_eq!(m.change_pin("1234", "5678"), Err(FidoError::PinBlocked));
    }
}
