//! In-memory MKAUTH device used by unit tests; produces real ECDSA signatures with the TEST key.

use crate::error::{Error, Result};
use crate::transport::Transport;
use multikey_proto::testkey;
use multikey_proto::{self as proto, StatusWord};
use std::sync::{Arc, Mutex};

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
        }
    }

    pub fn enrolled() -> Self {
        Self {
            enrolled: true,
            pin: b"123456".to_vec(),
            ..Self::blank()
        }
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
