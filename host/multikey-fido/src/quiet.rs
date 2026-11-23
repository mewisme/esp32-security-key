//! Silence the transport crate's stray `println!` output.
//!
//! `ctap-hid-fido2` prints diagnostics such as "Unknown member: 12" to *stdout* while parsing responses. That
//! would corrupt `--json` output, so every call into it runs with the process's stdout pointed at the null device
//! and restored afterwards. Our own output is written before or after such a call, never during it.

use std::io::Write;

/// Run `f` with stdout redirected to the null device. If the redirect cannot be set up, `f` still runs
/// (the stray text is then merely visible).
pub fn quiet<T>(f: impl FnOnce() -> T) -> T {
    let _ = std::io::stdout().flush();
    let guard = imp::redirect();
    let out = f();
    let _ = std::io::stdout().flush();
    drop(guard);
    out
}

#[cfg(unix)]
mod imp {
    use std::os::fd::AsRawFd;

    pub struct Guard {
        saved: libc::c_int,
    }

    pub fn redirect() -> Option<Guard> {
        let null = std::fs::OpenOptions::new()
            .write(true)
            .open("/dev/null")
            .ok()?;
        // SAFETY: plain fd duplication/replacement on descriptors we own; fd 1 is restored in Drop.
        unsafe {
            let saved = libc::dup(1);
            if saved < 0 {
                return None;
            }
            if libc::dup2(null.as_raw_fd(), 1) < 0 {
                libc::close(saved);
                return None;
            }
            Some(Guard { saved })
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            // SAFETY: restores the descriptor saved in `redirect` and closes the duplicate.
            unsafe {
                libc::dup2(self.saved, 1);
                libc::close(self.saved);
            }
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::os::windows::io::AsRawHandle;

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::Console::{GetStdHandle, SetStdHandle, STD_OUTPUT_HANDLE};

    pub struct Guard {
        saved: HANDLE,
        // Keep the NUL handle open until stdout is restored.
        _null: std::fs::File,
    }

    pub fn redirect() -> Option<Guard> {
        let null = std::fs::OpenOptions::new().write(true).open("NUL").ok()?;
        // SAFETY: GetStdHandle/SetStdHandle only swap the process's stdout handle; the original is restored in
        // Drop and the NUL file outlives the redirect. Rust's stdout re-reads the handle on every write.
        unsafe {
            let saved = GetStdHandle(STD_OUTPUT_HANDLE);
            if SetStdHandle(STD_OUTPUT_HANDLE, null.as_raw_handle() as HANDLE) == 0 {
                return None;
            }
            Some(Guard { saved, _null: null })
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            // SAFETY: restores the handle captured in `redirect`.
            unsafe {
                SetStdHandle(STD_OUTPUT_HANDLE, self.saved);
            }
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod imp {
    pub struct Guard;
    pub fn redirect() -> Option<Guard> {
        None
    }
}
