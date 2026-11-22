//! `pam_multikey.so`: authenticate a PAM user with the MKAUTH v1 applet.
//!
//! All decisions live in [`decide`], which is pure and tested with a mock device. The
//! `extern "C"` entry points only parse arguments, fetch the user name and call it.
//! No PIN is needed: CHALLENGE only requires the physical button press.
//! Nothing secret (nonces, signatures, keys) is ever logged.

use multikey_host::{default_trust_store_path, Device, Error, TrustStore, TrustedKey};
use std::os::raw::{c_char, c_int, c_void};
use std::path::PathBuf;
use std::time::Duration;

// Numeric PAM return codes, from Linux-PAM <security/_pam_types.h> (written from memory;
// verify against the headers on the build machine): PAM_SUCCESS 0, PAM_AUTH_ERR 7,
// PAM_AUTHINFO_UNAVAIL 9, PAM_USER_UNKNOWN 10, PAM_IGNORE 25.
pub const PAM_SUCCESS: c_int = 0;
pub const PAM_AUTH_ERR: c_int = 7;
pub const PAM_AUTHINFO_UNAVAIL: c_int = 9;
pub const PAM_USER_UNKNOWN: c_int = 10;
pub const PAM_IGNORE: c_int = 25;

pub const DEFAULT_TIMEOUT_SECS: u64 = 20;
pub const MAX_TIMEOUT_SECS: u64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PamResult {
    Success,
    AuthErr,
    AuthInfoUnavail,
    UserUnknown,
}

impl PamResult {
    pub fn code(self) -> c_int {
        match self {
            Self::Success => PAM_SUCCESS,
            Self::AuthErr => PAM_AUTH_ERR,
            Self::AuthInfoUnavail => PAM_AUTHINFO_UNAVAIL,
            Self::UserUnknown => PAM_USER_UNKNOWN,
        }
    }
}

/// One authentication attempt against a physical (or mock) device.
pub trait DeviceAuth {
    fn authenticate(&mut self, key: &TrustedKey, timeout: Duration) -> Result<(), Error>;
}

/// Real device over PC/SC; opened lazily so a missing pcscd/reader maps to an error.
pub struct PcscDevice;

impl DeviceAuth for PcscDevice {
    fn authenticate(&mut self, key: &TrustedKey, timeout: Duration) -> Result<(), Error> {
        Device::open(None)?.authenticate(key, timeout)
    }
}

/// Map a host-library error to a PAM result. Only a cryptographic or identity mismatch is a
/// hard `AuthErr`; everything environmental is `AuthInfoUnavail` so fallback keeps working.
pub fn map_error(e: &Error) -> PamResult {
    match e {
        Error::Verify(_) | Error::DeviceMismatch => PamResult::AuthErr,
        _ => PamResult::AuthInfoUnavail,
    }
}

/// Pure decision: `Success` only after a verified signature for `user`'s trusted key.
pub fn decide(
    user: &str,
    store: &TrustStore,
    dev: &mut dyn DeviceAuth,
    timeout: Duration,
) -> PamResult {
    if user.is_empty() {
        return PamResult::UserUnknown;
    }
    let Some(entry) = store.find(user) else {
        return PamResult::AuthInfoUnavail;
    };
    let Ok(key) = TrustedKey::from_entry(entry) else {
        return PamResult::AuthInfoUnavail;
    };
    match dev.authenticate(&key, timeout) {
        Ok(()) => PamResult::Success,
        Err(e) => map_error(&e),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub trust_store: PathBuf,
    pub timeout: Duration,
    pub debug: bool,
}

/// Parse PAM module arguments: `trust_store=/path`, `timeout=N` (1..=60), `debug`.
/// Unknown or malformed arguments are ignored (defaults apply).
pub fn parse_args<S: AsRef<str>>(args: &[S]) -> Options {
    let mut o = Options {
        trust_store: default_trust_store_path(),
        timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
        debug: false,
    };
    for a in args {
        let a = a.as_ref();
        if a == "debug" {
            o.debug = true;
        } else if let Some(p) = a.strip_prefix("trust_store=") {
            if !p.is_empty() {
                o.trust_store = PathBuf::from(p);
            }
        } else if let Some(n) = a.strip_prefix("timeout=") {
            if let Ok(n) = n.parse::<u64>() {
                o.timeout = Duration::from_secs(n.clamp(1, MAX_TIMEOUT_SECS));
            }
        }
    }
    o
}

/// Full flow used by `pam_sm_authenticate` (testable with a mock device).
pub fn authenticate_user(user: &str, opts: &Options, dev: &mut dyn DeviceAuth) -> PamResult {
    let store = match TrustStore::load_or_default(&opts.trust_store) {
        Ok(s) => s,
        Err(e) => {
            sys::debug(opts.debug, &format!("trust store unusable: {e}"));
            return PamResult::AuthInfoUnavail;
        }
    };
    let r = decide(user, &store, dev, opts.timeout);
    sys::debug(opts.debug, &format!("user={user} result={r:?}"));
    r
}

#[cfg(target_os = "linux")]
mod sys {
    use super::*;
    use std::ffi::{CStr, CString};

    #[link(name = "pam")]
    extern "C" {
        fn pam_get_user(
            pamh: *mut c_void,
            user: *mut *const c_char,
            prompt: *const c_char,
        ) -> c_int;
    }
    extern "C" {
        fn syslog(priority: c_int, fmt: *const c_char, ...);
    }
    const LOG_AUTHPRIV_DEBUG: c_int = (10 << 3) | 7;

    pub fn get_user(pamh: *mut c_void) -> Option<String> {
        let mut p: *const c_char = std::ptr::null();
        // SAFETY: pamh is the handle libpam passed to us; p receives a libpam-owned string.
        let rc = unsafe { pam_get_user(pamh, &mut p, std::ptr::null()) };
        if rc != PAM_SUCCESS || p.is_null() {
            return None;
        }
        // SAFETY: libpam returned a valid NUL-terminated string that outlives this call.
        Some(unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned())
    }

    pub fn debug(enabled: bool, msg: &str) {
        if !enabled {
            return;
        }
        if let Ok(c) = CString::new(format!("pam_multikey: {msg}")) {
            // SAFETY: constant "%s" format with one NUL-terminated string argument.
            unsafe { syslog(LOG_AUTHPRIV_DEBUG, c"%s".as_ptr(), c.as_ptr()) };
        }
    }
}

/// Non-Linux stub so the crate builds and the pure logic is testable (no PAM there).
#[cfg(not(target_os = "linux"))]
mod sys {
    use super::*;
    pub fn get_user(_pamh: *mut c_void) -> Option<String> {
        None
    }
    pub fn debug(_enabled: bool, _msg: &str) {}
}

/// Collect `argv` into owned strings.
///
/// # Safety
/// `argv` must point to `argc` valid NUL-terminated strings (as libpam guarantees) or be null.
unsafe fn collect_args(argc: c_int, argv: *const *const c_char) -> Vec<String> {
    if argv.is_null() || argc <= 0 {
        return Vec::new();
    }
    (0..argc as usize)
        .filter_map(|i| {
            let p = *argv.add(i);
            (!p.is_null()).then(|| std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned())
        })
        .collect()
}

/// # Safety
/// Called by libpam with a valid handle and argument vector.
#[no_mangle]
pub unsafe extern "C" fn pam_sm_authenticate(
    pamh: *mut c_void,
    _flags: c_int,
    argc: c_int,
    argv: *const *const c_char,
) -> c_int {
    let args = collect_args(argc, argv);
    // Never unwind into the PAM host; any panic degrades to "unavailable".
    std::panic::catch_unwind(|| {
        let opts = parse_args(&args);
        match sys::get_user(pamh) {
            Some(user) => authenticate_user(&user, &opts, &mut PcscDevice).code(),
            None => PAM_USER_UNKNOWN,
        }
    })
    .unwrap_or(PAM_AUTHINFO_UNAVAIL)
}

#[no_mangle]
pub extern "C" fn pam_sm_setcred(
    _pamh: *mut c_void,
    _flags: c_int,
    _argc: c_int,
    _argv: *const *const c_char,
) -> c_int {
    PAM_SUCCESS
}

#[no_mangle]
pub extern "C" fn pam_sm_acct_mgmt(
    _pamh: *mut c_void,
    _flags: c_int,
    _argc: c_int,
    _argv: *const *const c_char,
) -> c_int {
    PAM_IGNORE
}

#[no_mangle]
pub extern "C" fn pam_sm_chauthtok(
    _pamh: *mut c_void,
    _flags: c_int,
    _argc: c_int,
    _argv: *const *const c_char,
) -> c_int {
    PAM_IGNORE
}

#[cfg(test)]
mod tests {
    use super::*;
    use multikey_host::KeyEntry;
    use multikey_proto::{testkey, VerifyError};

    struct Mock(Option<fn() -> Error>, u32);
    impl DeviceAuth for Mock {
        fn authenticate(&mut self, key: &TrustedKey, _t: Duration) -> Result<(), Error> {
            self.1 += 1;
            assert_eq!(key.pubkey, testkey::public_key());
            match self.0 {
                None => Ok(()),
                Some(f) => Err(f()),
            }
        }
    }

    const T: Duration = Duration::from_secs(5);

    fn store() -> TrustStore {
        let mut s = TrustStore::default();
        s.add(KeyEntry::new(
            "alice",
            &testkey::public_key(),
            &testkey::TEST_DEVICE_ID,
        ))
        .unwrap();
        s
    }

    fn run(user: &str, s: &TrustStore, m: &mut Mock) -> PamResult {
        decide(user, s, m, T)
    }

    #[test]
    fn success_after_verified_auth() {
        let mut m = Mock(None, 0);
        assert_eq!(run("alice", &store(), &mut m), PamResult::Success);
        assert_eq!(m.1, 1);
    }

    #[test]
    fn empty_user_is_unknown_and_device_untouched() {
        let mut m = Mock(None, 0);
        assert_eq!(run("", &store(), &mut m), PamResult::UserUnknown);
        assert_eq!(m.1, 0);
    }

    #[test]
    fn user_without_entry_is_unavailable_and_device_untouched() {
        let mut m = Mock(None, 0);
        assert_eq!(run("bob", &store(), &mut m), PamResult::AuthInfoUnavail);
        assert_eq!(m.1, 0);
    }

    #[test]
    fn empty_store_is_unavailable() {
        let mut m = Mock(None, 0);
        assert_eq!(
            run("alice", &TrustStore::default(), &mut m),
            PamResult::AuthInfoUnavail
        );
    }

    #[test]
    fn signature_mismatch_is_auth_err() {
        let mut m = Mock(Some(|| Error::Verify(VerifyError::BadSignature)), 0);
        assert_eq!(run("alice", &store(), &mut m), PamResult::AuthErr);
    }

    #[test]
    fn device_mismatch_is_auth_err() {
        let mut m = Mock(Some(|| Error::DeviceMismatch), 0);
        assert_eq!(run("alice", &store(), &mut m), PamResult::AuthErr);
    }

    #[test]
    fn environmental_failures_are_unavailable() {
        let cases: [fn() -> Error; 8] = [
            || Error::NoDevice,
            || Error::NoService("pcscd".into()),
            || Error::DeviceRemoved,
            || Error::Pcsc("x".into()),
            || Error::BadSelect,
            || Error::NoUserPresence,
            || Error::NotEnrolled,
            || Error::Timeout(Duration::from_secs(1)),
        ];
        for c in cases {
            let mut m = Mock(Some(c), 0);
            assert_eq!(
                run("alice", &store(), &mut m),
                PamResult::AuthInfoUnavail,
                "{}",
                c()
            );
        }
    }

    #[test]
    fn pam_codes() {
        assert_eq!(PamResult::Success.code(), 0);
        assert_eq!(PamResult::AuthErr.code(), 7);
        assert_eq!(PamResult::AuthInfoUnavail.code(), 9);
        assert_eq!(PamResult::UserUnknown.code(), 10);
        assert_eq!(PAM_IGNORE, 25);
    }

    #[test]
    fn args_defaults_and_overrides() {
        let o = parse_args::<&str>(&[]);
        assert_eq!(o.timeout, Duration::from_secs(20));
        assert!(!o.debug);
        assert_eq!(o.trust_store, default_trust_store_path());
        let o = parse_args(&["debug", "trust_store=/tmp/t.toml", "timeout=30", "bogus"]);
        assert!(o.debug);
        assert_eq!(o.trust_store, PathBuf::from("/tmp/t.toml"));
        assert_eq!(o.timeout, Duration::from_secs(30));
    }

    #[test]
    fn args_timeout_clamped_and_garbage_ignored() {
        assert_eq!(
            parse_args(&["timeout=999"]).timeout,
            Duration::from_secs(60)
        );
        assert_eq!(parse_args(&["timeout=0"]).timeout, Duration::from_secs(1));
        assert_eq!(
            parse_args(&["timeout=abc"]).timeout,
            Duration::from_secs(20)
        );
        assert_eq!(
            parse_args(&["trust_store="]).trust_store,
            default_trust_store_path()
        );
    }

    #[test]
    fn authenticate_user_missing_store_file_is_unavailable() {
        let o = Options {
            trust_store: PathBuf::from("/nonexistent/multikey/trusted.toml"),
            timeout: T,
            debug: false,
        };
        let mut m = Mock(None, 0);
        assert_eq!(
            authenticate_user("alice", &o, &mut m),
            PamResult::AuthInfoUnavail
        );
        assert_eq!(m.1, 0);
    }
}
