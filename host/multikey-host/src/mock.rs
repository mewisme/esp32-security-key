//! In-memory MKAUTH device used by unit tests; produces real ECDSA signatures with the TEST key.

use crate::error::{Error, Result};
use crate::transport::Transport;
use multikey_proto::testkey;
use multikey_proto::{self as proto, StatusWord};
use std::sync::{Arc, Mutex};

/// Build-time default product name (CONFIG_MULTIKEY_USB_PRODUCT_NAME).
pub const DEFAULT_NAME: &str = "MultiKeys Security Key";
pub struct MockDevice {
    pub enrolled: bool,
    pub pin: Vec<u8>,
    pub retries: u8,
    pub button: bool,
    pub removed: bool,
    pub select_ok: bool,
    pub force_challenge_sw: Option<u16>,
    pub corrupt_signature: bool,
    pub sign_wrong_host_nonce: bool,
    pub sign_wrong_device_id: bool,
    pub truncate_challenge: bool,
    /// Host nonces seen in CHALLENGE commands.
    pub challenges: Vec<Vec<u8>>,
    counter: u8,
    /// Name stored by INS 06 (`None` = build-time default).
    pub stored_name: Option<String>,
    /// Name the host currently sees (changes on re-enumeration only).
    pub active_name: String,
    pub reenumerations: u32,
    /// Response data of INS 07 (`None` = a firmware that predates it, answering 6D00).
    pub build_info: Option<Vec<u8>>,
}

impl MockDevice {
    pub fn blank() -> Self {
        Self {
            enrolled: false,
            pin: Vec::new(),
            retries: 8,
            button: true,
            removed: false,
            select_ok: true,
            force_challenge_sw: None,
            corrupt_signature: false,
            sign_wrong_host_nonce: false,
            sign_wrong_device_id: false,
            truncate_challenge: false,
            challenges: Vec::new(),
            counter: 0,
            stored_name: None,
            active_name: DEFAULT_NAME.to_owned(),
            reenumerations: 0,
            build_info: None,
        }
    }

    pub fn enrolled() -> Self {
        Self {
            enrolled: true,
            pin: b"123456".to_vec(),
            ..Self::blank()
        }
    }

    fn name_response(&self) -> Vec<u8> {
        let effective = self.stored_name.as_deref().unwrap_or(DEFAULT_NAME);
        let mut flags = 0x04;
        if self.stored_name.is_some() {
            flags |= 0x01;
        }
        if effective != self.active_name {
            flags |= 0x02;
        }
        let mut v = vec![flags];
        v.extend_from_slice(effective.as_bytes());
        Self::sw(0x9000, v)
    }

    /// Mirrors `cmd_device_name` in components/multikey_auth/multikey_auth.c.
    fn handle_name(&mut self, p1: u8, p2: u8, data: &[u8]) -> Vec<u8> {
        if p1 == proto::NAME_GET {
            return self.name_response();
        }
        if !matches!(p1, proto::NAME_SET | proto::NAME_CLEAR | proto::NAME_REENUM) {
            return Self::sw(0x6A86, vec![]);
        }
        if data.is_empty() || 1 + data[0] as usize > data.len() {
            return Self::sw(0x6700, vec![]);
        }
        let pin_len = data[0] as usize;
        let pin = &data[1..1 + pin_len];
        let rest = &data[1 + pin_len..];
        let name = if p1 == proto::NAME_SET {
            match std::str::from_utf8(rest) {
                Ok(n) if proto::validate_device_name(n).is_ok() => Some(n.to_owned()),
                _ => return Self::sw(0x6A80, vec![]),
            }
        } else {
            None
        };
        if self.enrolled {
            if self.retries == 0 {
                return Self::sw(0x6983, vec![]);
            }
            if !(6..=63).contains(&pin_len) {
                return Self::sw(0x6700, vec![]);
            }
            if pin != self.pin.as_slice() {
                self.retries -= 1;
                return Self::sw(0x63C0 | u16::from(self.retries), vec![]);
            }
            self.retries = 8;
        } else if pin_len != 0 {
            return Self::sw(0x6A80, vec![]);
        }
        if !self.button {
            return Self::sw(0x6300, vec![]);
        }
        match p1 {
            proto::NAME_SET | proto::NAME_CLEAR => {
                self.stored_name = name;
                let resp = self.name_response();
                if p2 & 1 != 0 {
                    self.reenumerate();
                }
                resp
            }
            _ => {
                if !rest.is_empty() {
                    return Self::sw(0x6700, vec![]);
                }
                self.reenumerate();
                Self::sw(0x9000, vec![])
            }
        }
    }

    fn reenumerate(&mut self) {
        self.active_name = self
            .stored_name
            .clone()
            .unwrap_or_else(|| DEFAULT_NAME.to_owned());
        self.reenumerations += 1;
    }

    fn sw(sw: u16, mut data: Vec<u8>) -> Vec<u8> {
        data.extend_from_slice(&sw.to_be_bytes());
        data
    }

    fn handle(&mut self, apdu: &[u8]) -> Vec<u8> {
        if apdu[1] == 0xA4 {
            return if self.select_ok {
                Self::sw(0x9000, proto::SELECT_RESPONSE.to_vec())
            } else {
                Self::sw(0x6A82, vec![])
            };
        }
        assert_eq!(apdu[0], proto::CLA);
        let lc = apdu[4] as usize;
        let data = &apdu[5..5 + lc];
        match apdu[1] {
            proto::INS_GET_INFO => {
                let mut v = vec![1, u8::from(self.enrolled), 1];
                v.extend_from_slice(&testkey::TEST_DEVICE_ID);
                if self.enrolled {
                    v.extend_from_slice(&testkey::public_key());
                }
                Self::sw(0x9000, v)
            }
            proto::INS_ENROLL => {
                if self.enrolled {
                    return Self::sw(0x6985, vec![]);
                }
                if !(6..=63).contains(&data.len()) {
                    return Self::sw(0x6700, vec![]);
                }
                if !self.button {
                    return Self::sw(0x6300, vec![]);
                }
                self.enrolled = true;
                self.pin = data.to_vec();
                self.retries = 8;
                let mut v = testkey::public_key().to_vec();
                v.extend_from_slice(&testkey::TEST_DEVICE_ID);
                Self::sw(0x9000, v)
            }
            proto::INS_CHALLENGE => {
                if let Some(sw) = self.force_challenge_sw {
                    return Self::sw(sw, vec![]);
                }
                if !self.enrolled {
                    return Self::sw(0x6985, vec![]);
                }
                if !self.button {
                    return Self::sw(0x6300, vec![]);
                }
                assert_eq!(lc, 32);
                self.challenges.push(data.to_vec());
                self.counter = self.counter.wrapping_add(1);
                let dn = [self.counter; 32];
                let mut hn: [u8; 32] = data.try_into().unwrap();
                if self.sign_wrong_host_nonce {
                    hn[0] ^= 0xFF;
                }
                let mut id = testkey::TEST_DEVICE_ID;
                if self.sign_wrong_device_id {
                    id[0] ^= 0xFF;
                }
                let mut sig = testkey::sign(&proto::transcript(&hn, &dn, &id));
                if self.corrupt_signature {
                    let n = sig.len();
                    sig[n - 1] ^= 1;
                }
                let mut v = dn.to_vec();
                v.extend_from_slice(&sig);
                if self.truncate_challenge {
                    v.truncate(20);
                }
                Self::sw(0x9000, v)
            }
            proto::INS_REVOKE => {
                if !self.enrolled {
                    return Self::sw(0x6985, vec![]);
                }
                if self.retries == 0 {
                    return Self::sw(0x6983, vec![]);
                }
                if data != self.pin.as_slice() {
                    self.retries -= 1;
                    return Self::sw(0x63C0 | u16::from(self.retries), vec![]);
                }
                if !self.button {
                    return Self::sw(0x6300, vec![]);
                }
                self.enrolled = false;
                self.pin.clear();
                self.retries = 8;
                Self::sw(0x9000, vec![])
            }
            proto::INS_DEVICE_NAME => self.handle_name(apdu[2], apdu[3], data),
            proto::INS_BUILD_INFO => match &self.build_info {
                Some(bytes) => Self::sw(0x9000, bytes.clone()),
                None => Self::sw(StatusWord::UnknownIns.into(), vec![]),
            },
            _ => Self::sw(StatusWord::UnknownIns.into(), vec![]),
        }
    }
}

/// Cloneable handle so tests can inspect the device after handing a transport to `Device`.
#[derive(Clone)]
pub struct Shared(Arc<Mutex<MockDevice>>);

impl Shared {
    pub fn new(m: MockDevice) -> Self {
        Self(Arc::new(Mutex::new(m)))
    }
    pub fn with<R>(&self, f: impl FnOnce(&MockDevice) -> R) -> R {
        f(&self.0.lock().unwrap())
    }
}

impl Transport for Shared {
    fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        let mut m = self.0.lock().unwrap();
        if m.removed {
            return Err(Error::DeviceRemoved);
        }
        Ok(m.handle(apdu))
    }
}
