use crate::error::{Error, Result};
use crate::transport::{PcscTransport, Transport};
use crate::trust::KeyEntry;
use multikey_proto::{
    self as proto, BuildInfo, DeviceName, Enrollment, Info, StatusWord, DEVICE_ID_LEN, NONCE_LEN,
    PUBKEY_LEN, SELECT_RESPONSE,
};
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;

/// A key the verifier trusts: public key and the device id bound to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustedKey {
    pub pubkey: [u8; PUBKEY_LEN],
    pub device_id: [u8; DEVICE_ID_LEN],
}

impl TrustedKey {
    pub fn from_entry(entry: &KeyEntry) -> std::result::Result<Self, crate::trust::TrustError> {
        let (pubkey, device_id) = entry.decode()?;
        Ok(Self { pubkey, device_id })
    }
}

pub struct Device<T: Transport> {
    transport: T,
}

impl Device<PcscTransport> {
    /// Open a reader by name (exact or substring, case-insensitive); `None` picks the first
    /// reader whose name contains "MultiKeys" or "ESP32".
    pub fn open(reader: Option<&str>) -> Result<Self> {
        Ok(Self::new(PcscTransport::open(reader)?))
    }
}

impl<T: Transport> Device<T> {
    pub fn new(transport: T) -> Self {
        Self { transport }
    }

    fn exchange(&mut self, apdu: &[u8]) -> Result<(Vec<u8>, StatusWord)> {
        let resp = self.transport.transmit(apdu)?;
        let (data, sw) = proto::split_response(&resp)?;
        Ok((data.to_vec(), sw))
    }

    /// Send a command; non-OK status words are mapped by `on_state` (for 6985) then generically.
    fn command(&mut self, apdu: &[u8], on_state: Error) -> Result<Vec<u8>> {
        let (data, sw) = self.exchange(apdu)?;
        match sw {
            StatusWord::Ok => Ok(data),
            StatusWord::NoUserPresence => Err(Error::NoUserPresence),
            StatusWord::WrongState => Err(on_state),
            StatusWord::RetriesLeft(n) => Err(Error::PinRetries(n)),
            StatusWord::PinBlocked => Err(Error::PinBlocked),
            other => Err(Error::Status(other.into())),
        }
    }

    /// Select the MKAUTH applet.
    pub fn select(&mut self) -> Result<()> {
        let (data, sw) = self.exchange(&proto::select_apdu())?;
        if sw == StatusWord::Ok && data == SELECT_RESPONSE {
            Ok(())
        } else {
            Err(Error::BadSelect)
        }
    }

    pub fn info(&mut self) -> Result<Info> {
        let data = self.command(&proto::get_info_apdu(), Error::NotEnrolled)?;
        Ok(proto::parse_info(&data)?)
    }

    /// Enroll: sets the PIN and generates the key (the user must press the button).
    pub fn enroll(&mut self, pin: &[u8]) -> Result<Enrollment> {
        let apdu = proto::enroll_apdu(pin)?;
        let data = self.command(&apdu, Error::AlreadyEnrolled)?;
        Ok(proto::parse_enroll(&data)?)
    }

    /// Delete the device key and PIN (PIN + button press).
    pub fn revoke(&mut self, pin: &[u8]) -> Result<()> {
        let apdu = proto::revoke_apdu(pin)?;
        self.command(&apdu, Error::NotEnrolled).map(|_| ())
    }

    /// Name commands: 6985 means renaming is compiled out, 6D00 means the firmware predates INS 06.
    fn name_command(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        self.command(apdu, Error::RenameDisabled)
            .map_err(|e| match e {
                Error::Status(0x6D00) => Error::NameUnsupported,
                Error::Status(0x6A80) => Error::NameRejected,
                other => other,
            })
    }

    /// Read the device name. No authorization needed.
    pub fn device_name(&mut self) -> Result<DeviceName> {
        let data = self.name_command(&proto::device_name_get_apdu())?;
        Ok(proto::parse_device_name(&data)?)
    }

    /// Store a user-chosen device name (button press, plus the MKAUTH PIN once enrolled; pass an empty
    /// `pin` while not enrolled). The new name is used from the next USB enumeration; with `reenumerate`
    /// the device detaches/attaches USB right after answering (the reader then reappears).
    pub fn set_device_name(
        &mut self,
        pin: &[u8],
        name: &str,
        reenumerate: bool,
    ) -> Result<DeviceName> {
        let apdu = proto::device_name_set_apdu(pin, name, reenumerate)?;
        let data = self.name_command(&apdu)?;
        Ok(proto::parse_device_name(&data)?)
    }

    /// Restore the build-time default name (same authorization as `set_device_name`).
    pub fn clear_device_name(&mut self, pin: &[u8], reenumerate: bool) -> Result<DeviceName> {
        let apdu = proto::device_name_clear_apdu(pin, reenumerate)?;
        let data = self.name_command(&apdu)?;
        Ok(proto::parse_device_name(&data)?)
    }

    /// Ask the device to detach from USB for about a second so the host re-reads its descriptors. The
    /// reader disappears and reappears; the connection must be reopened afterwards.
    pub fn reenumerate(&mut self, pin: &[u8]) -> Result<()> {
        let apdu = proto::device_name_reenumerate_apdu(pin)?;
        self.name_command(&apdu).map(|_| ())
    }

    /// Read what the running firmware is (INS 07): name, version, source commit, image SHA-256, chip. Needs no
    /// button and no PIN. A firmware built before this command answers 6D00 (`BuildInfoUnsupported`).
    pub fn build_info(&mut self) -> Result<BuildInfo> {
        let data = self
            .command(&proto::build_info_apdu(), Error::Status(0x6985))
            .map_err(|e| match e {
                Error::Status(0x6D00) => Error::BuildInfoUnsupported,
                other => other,
            })?;
        Ok(proto::parse_build_info(&data)?)
    }

    /// Challenge-response authentication against `trusted`.
    ///
    /// The timeout is checked around the (blocking) PC/SC call; the device itself aborts
    /// with `6300` after its own user-presence timeout.
    pub fn authenticate(&mut self, trusted: &TrustedKey, timeout: Duration) -> Result<()> {
        let start = Instant::now();
        let late = || Error::Timeout(timeout);
        self.select()?;
        let info = self.info()?;
        if !info.enrolled {
            return Err(Error::NotEnrolled);
        }
        let dev_pk = info.pubkey.ok_or(Error::NotEnrolled)?;
        let same = dev_pk.ct_eq(&trusted.pubkey) & info.device_id.ct_eq(&trusted.device_id);
        if !bool::from(same) {
            return Err(Error::DeviceMismatch);
        }

        let mut host_nonce = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut host_nonce).map_err(|_| Error::Random)?;
        if start.elapsed() > timeout {
            return Err(late());
        }
        let data = self.command(&proto::challenge_apdu(&host_nonce), Error::NotEnrolled)?;
        if start.elapsed() > timeout {
            return Err(late());
        }
        let ch = proto::parse_challenge(&data)?;
        let t = proto::transcript(&host_nonce, &ch.device_nonce, &trusted.device_id);
        proto::verify(&trusted.pubkey, &t, &ch.signature_der)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mock::{MockDevice, Shared};
    use multikey_proto::testkey;
    use multikey_proto::VerifyError;

    const T: Duration = Duration::from_secs(20);

    fn trusted() -> TrustedKey {
        TrustedKey {
            pubkey: testkey::public_key(),
            device_id: testkey::TEST_DEVICE_ID,
        }
    }

    fn dev(m: MockDevice) -> (Device<Shared>, Shared) {
        let s = Shared::new(m);
        (Device::new(s.clone()), s)
    }

    #[test]
    fn authenticate_success() {
        let (mut d, _) = dev(MockDevice::enrolled());
        d.authenticate(&trusted(), T).unwrap();
    }

    #[test]
    fn authenticate_uses_fresh_nonce_each_time() {
        let (mut d, s) = dev(MockDevice::enrolled());
        d.authenticate(&trusted(), T).unwrap();
        d.authenticate(&trusted(), T).unwrap();
        let log = s.with(|m| m.challenges.clone());
        assert_eq!(log.len(), 2);
        assert_ne!(log[0], log[1]);
    }

    #[test]
    fn no_user_presence() {
        let mut m = MockDevice::enrolled();
        m.button = false;
        let (mut d, _) = dev(m);
        assert!(matches!(
            d.authenticate(&trusted(), T),
            Err(Error::NoUserPresence)
        ));
    }

    #[test]
    fn not_enrolled() {
        let (mut d, _) = dev(MockDevice::blank());
        assert!(matches!(
            d.authenticate(&trusted(), T),
            Err(Error::NotEnrolled)
        ));
    }

    #[test]
    fn challenge_wrong_state_maps_to_not_enrolled() {
        let mut m = MockDevice::enrolled();
        m.force_challenge_sw = Some(0x6985);
        let (mut d, _) = dev(m);
        assert!(matches!(
            d.authenticate(&trusted(), T),
            Err(Error::NotEnrolled)
        ));
    }

    #[test]
    fn other_status_words() {
        let mut m = MockDevice::enrolled();
        m.force_challenge_sw = Some(0x6F00);
        let (mut d, _) = dev(m);
        assert!(matches!(
            d.authenticate(&trusted(), T),
            Err(Error::Status(0x6F00))
        ));
        let mut m = MockDevice::enrolled();
        m.force_challenge_sw = Some(0x63C2);
        let (mut d, _) = dev(m);
        assert!(matches!(
            d.authenticate(&trusted(), T),
            Err(Error::PinRetries(2))
        ));
    }

    #[test]
    fn untrusted_key_or_device_id_mismatch() {
        let (mut d, _) = dev(MockDevice::enrolled());
        let mut t = trusted();
        t.device_id[0] ^= 1;
        assert!(matches!(d.authenticate(&t, T), Err(Error::DeviceMismatch)));
        let mut t = trusted();
        t.pubkey[10] ^= 1;
        assert!(matches!(d.authenticate(&t, T), Err(Error::DeviceMismatch)));
    }

    #[test]
    fn forged_signatures_rejected() {
        // Device that lies in GET_INFO (claims trusted identity) but signs garbage.
        let mut m = MockDevice::enrolled();
        m.corrupt_signature = true;
        let (mut d, _) = dev(m);
        assert!(matches!(
            d.authenticate(&trusted(), T),
            Err(Error::Verify(_))
        ));
        // Signature over a stale host nonce (replay).
        let mut m = MockDevice::enrolled();
        m.sign_wrong_host_nonce = true;
        let (mut d, _) = dev(m);
        assert!(matches!(
            d.authenticate(&trusted(), T),
            Err(Error::Verify(VerifyError::BadSignature))
        ));
        // Signature binds a different device_id than the trusted one.
        let mut m = MockDevice::enrolled();
        m.sign_wrong_device_id = true;
        let (mut d, _) = dev(m);
        assert!(matches!(
            d.authenticate(&trusted(), T),
            Err(Error::Verify(_))
        ));
    }

    #[test]
    fn malformed_responses() {
        let mut m = MockDevice::enrolled();
        m.truncate_challenge = true;
        let (mut d, _) = dev(m);
        assert!(matches!(
            d.authenticate(&trusted(), T),
            Err(Error::Proto(_))
        ));
    }

    #[test]
    fn device_removed_and_bad_select() {
        let mut m = MockDevice::enrolled();
        m.removed = true;
        let (mut d, _) = dev(m);
        assert!(matches!(
            d.authenticate(&trusted(), T),
            Err(Error::DeviceRemoved)
        ));
        let mut m = MockDevice::enrolled();
        m.select_ok = false;
        let (mut d, _) = dev(m);
        assert!(matches!(
            d.authenticate(&trusted(), T),
            Err(Error::BadSelect)
        ));
    }

    #[test]
    fn timeout_enforced() {
        let (mut d, _) = dev(MockDevice::enrolled());
        assert!(matches!(
            d.authenticate(&trusted(), Duration::ZERO),
            Err(Error::Timeout(_))
        ));
    }

    #[test]
    fn enroll_flow() {
        let (mut d, s) = dev(MockDevice::blank());
        d.select().unwrap();
        assert!(!d.info().unwrap().enrolled);
        let e = d.enroll(b"123456").unwrap();
        assert_eq!(e.pubkey, testkey::public_key());
        assert_eq!(e.device_id, testkey::TEST_DEVICE_ID);
        let i = d.info().unwrap();
        assert!(i.enrolled && i.pubkey == Some(testkey::public_key()));
        assert_eq!(s.with(|m| m.pin.clone()), b"123456");
        assert!(matches!(d.enroll(b"123456"), Err(Error::AlreadyEnrolled)));
        d.authenticate(&trusted(), T).unwrap();
    }

    #[test]
    fn enroll_errors() {
        let (mut d, _) = dev(MockDevice::blank());
        assert!(matches!(d.enroll(b"123"), Err(Error::Proto(_))));
        let mut m = MockDevice::blank();
        m.button = false;
        let (mut d, s) = dev(m);
        assert!(matches!(d.enroll(b"123456"), Err(Error::NoUserPresence)));
        assert!(!s.with(|m| m.enrolled));
    }

    #[test]
    fn revoke_flow_and_pin_retries() {
        let (mut d, s) = dev(MockDevice::enrolled());
        assert!(matches!(d.revoke(b"000000"), Err(Error::PinRetries(7))));
        assert!(s.with(|m| m.enrolled));
        d.revoke(b"123456").unwrap();
        assert!(!s.with(|m| m.enrolled));
        assert!(matches!(d.revoke(b"123456"), Err(Error::NotEnrolled)));
    }

    #[test]
    fn pin_blocked() {
        let mut m = MockDevice::enrolled();
        m.retries = 0;
        let (mut d, _) = dev(m);
        assert!(matches!(d.revoke(b"123456"), Err(Error::PinBlocked)));
    }

    #[test]
    fn trusted_key_from_entry() {
        let e = KeyEntry::new("alice", &testkey::public_key(), &testkey::TEST_DEVICE_ID);
        assert_eq!(TrustedKey::from_entry(&e).unwrap(), trusted());
    }

    #[test]
    fn build_info_reads_without_button_or_pin() {
        let mut m = MockDevice::enrolled();
        m.button = false; // a read must not need the button
        m.build_info = Some(vec![0x01, 0x02, 0x05, b'0', b'.', b'3', b'.', b'0']);
        let (mut d, _) = dev(m);
        let info = d.build_info().unwrap();
        assert_eq!(info.version.as_deref(), Some("0.3.0"));
    }

    #[test]
    fn build_info_on_a_firmware_without_ins_07() {
        let (mut d, _) = dev(MockDevice::blank()); // answers 6D00
        assert!(matches!(d.build_info(), Err(Error::BuildInfoUnsupported)));
    }

    #[test]
    fn rename_unenrolled_needs_button_only() {
        let (mut d, s) = dev(MockDevice::blank());
        let n = d.set_device_name(&[], "Mew's Security Key", false).unwrap();
        assert!(n.custom && n.reenumeration_pending);
        assert_eq!(n.name, "Mew's Security Key");
        assert_eq!(
            s.with(|m| m.stored_name.clone()).as_deref(),
            Some("Mew's Security Key")
        );
        // The host still sees the old name until re-enumeration.
        assert_eq!(s.with(|m| m.active_name.clone()), crate::mock::DEFAULT_NAME);
    }

    #[test]
    fn rename_without_button_changes_nothing() {
        let mut m = MockDevice::blank();
        m.button = false;
        let (mut d, s) = dev(m);
        assert!(matches!(
            d.set_device_name(&[], "Other", false),
            Err(Error::NoUserPresence)
        ));
        assert!(s.with(|m| m.stored_name.is_none()));
    }

    #[test]
    fn rename_enrolled_requires_pin() {
        let (mut d, s) = dev(MockDevice::enrolled());
        // No PIN: the device refuses and the name is untouched.
        assert!(d.set_device_name(&[], "NoPin", false).is_err());
        assert!(s.with(|m| m.stored_name.is_none()));
        // Wrong PIN burns a try and changes nothing.
        assert!(matches!(
            d.set_device_name(b"654321", "BadPin", false),
            Err(Error::PinRetries(7))
        ));
        assert!(s.with(|m| m.stored_name.is_none()));
        // Right PIN works and restores the counter.
        d.set_device_name(b"123456", "Good", false).unwrap();
        assert_eq!(s.with(|m| m.stored_name.clone()).as_deref(), Some("Good"));
        assert_eq!(s.with(|m| m.retries), 8);
    }

    #[test]
    fn rename_does_not_touch_enrollment() {
        let (mut d, s) = dev(MockDevice::enrolled());
        let before = d.info().unwrap();
        d.set_device_name(b"123456", "Renamed", true).unwrap();
        d.clear_device_name(b"123456", false).unwrap();
        let after = d.info().unwrap();
        assert_eq!(before, after);
        assert!(s.with(|m| m.enrolled));
    }

    #[test]
    fn invalid_names_never_reach_the_device() {
        let (mut d, s) = dev(MockDevice::enrolled());
        for bad in ["", " x", "x ", "Kh\u{f3}a", "\u{1F511}", &"x".repeat(32)] {
            assert!(matches!(
                d.set_device_name(b"123456", bad, false),
                Err(Error::Proto(_))
            ));
        }
        // No PIN attempt was consumed either.
        assert_eq!(s.with(|m| m.retries), 8);
        assert!(s.with(|m| m.stored_name.is_none()));
    }

    #[test]
    fn reenumeration_applies_the_stored_name() {
        let (mut d, s) = dev(MockDevice::blank());
        d.set_device_name(&[], "Fresh", true).unwrap();
        let n = d.device_name().unwrap();
        assert!(!n.reenumeration_pending);
        assert_eq!(s.with(|m| m.active_name.clone()), "Fresh");
        assert_eq!(s.with(|m| m.reenumerations), 1);
        // A standalone re-enumeration is allowed and counted.
        d.reenumerate(&[]).unwrap();
        assert_eq!(s.with(|m| m.reenumerations), 2);
    }

    #[test]
    fn reset_name_restores_default_and_reading_needs_no_auth() {
        let mut m = MockDevice::enrolled();
        m.button = false; // reading must not need the button or the PIN
        m.stored_name = Some("Custom".into());
        m.active_name = "Custom".into();
        let (mut d, s) = dev(m);
        let n = d.device_name().unwrap();
        assert!(n.custom && !n.reenumeration_pending);
        assert_eq!(n.name, "Custom");
        s.with(|_| ());
        assert!(matches!(
            d.clear_device_name(b"123456", false),
            Err(Error::NoUserPresence)
        ));
    }

    #[test]
    fn reset_name_with_button() {
        let mut m = MockDevice::blank();
        m.stored_name = Some("Custom".into());
        m.active_name = "Custom".into();
        let (mut d, s) = dev(m);
        let n = d.clear_device_name(&[], false).unwrap();
        assert!(!n.custom && n.reenumeration_pending);
        assert_eq!(n.name, crate::mock::DEFAULT_NAME);
        assert!(s.with(|m| m.stored_name.is_none()));
    }
}
