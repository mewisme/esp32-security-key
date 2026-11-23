//! `multikey fido ...`: authenticatorGetInfo, FIDO PIN and credential management.
//!
//! Every function takes an [`Authenticator`] and a [`Console`], so the whole flow runs against the mock in tests.
//! PINs live in `Zeroizing<String>`, are only handed to the library as `&str` and never reach any output.

use multikey_fido::{Authenticator, CredEntry, FidoError, PinState};
use zeroize::Zeroizing;

use crate::console::Console;
use crate::error::{msg, CliError, Res};
use crate::output::emit;

const PIN_SET_WARNING: &str = "\
WARNING: a FIDO PIN is persistent.
 - On this firmware, setting it ends touch-only use: browsers will ask for the PIN and the key becomes
   PIN-protected (see docs/FIDO_UV.md).
 - It can only be removed by authenticatorReset, which deletes EVERY credential on the key.
 - This is the FIDO PIN, not the MKAUTH management PIN.";

pub fn info(a: &dyn Authenticator, c: &mut dyn Console, json: bool) -> Res {
    let i = a.info()?;
    emit(c.out(), json, &i, |w| {
        writeln!(w, "versions         : {}", i.versions.join(", "))?;
        writeln!(w, "aaguid           : {}", i.aaguid)?;
        match i.firmware_version {
            Some(v) => writeln!(
                w,
                "firmware version : {v:#x} (pico-fido core version, not a MultiKeys build id)"
            )?,
            None => writeln!(w, "firmware version : (not reported)")?,
        }
        let opts: Vec<String> = i.options.iter().map(|(k, v)| format!("{k}={v}")).collect();
        writeln!(w, "options          : {}", opts.join(", "))?;
        writeln!(w, "extensions       : {}", i.extensions.join(", "))?;
        let protos: Vec<String> = i.pin_protocols.iter().map(u32::to_string).collect();
        writeln!(w, "pin protocols    : {}", protos.join(", "))?;
        if let Some(m) = i.min_pin_length {
            writeln!(w, "min PIN length   : {m}")?;
        }
        Ok(())
    })
}

pub fn pin_status(a: &dyn Authenticator, c: &mut dyn Console, json: bool) -> Res {
    let s = a.pin_status()?;
    emit(c.out(), json, &s, |w| {
        let state = match s.client_pin {
            PinState::Unsupported => "not supported",
            PinState::NotSet => "not set",
            PinState::Set => "set",
        };
        writeln!(w, "FIDO PIN         : {state}")?;
        if let Some(r) = s.retries {
            writeln!(w, "retries left     : {r}")?;
        }
        if let Some(v) = s.always_uv {
            writeln!(w, "alwaysUv         : {v}")?;
        }
        if let Some(v) = s.make_cred_uv_not_rqd {
            writeln!(w, "makeCredUvNotRqd : {v}")?;
        }
        writeln!(
            w,
            "credential mgmt  : {}",
            if s.cred_mgmt {
                "supported"
            } else {
                "not supported"
            }
        )
    })
}

/// Read a new PIN twice (or once from stdin) and require both entries to match.
fn read_new_pin(
    c: &mut dyn Console,
    prompt: &str,
    stdin_mode: bool,
) -> Result<Zeroizing<String>, CliError> {
    if stdin_mode {
        return c.stdin_secret();
    }
    let first = c.secret(prompt)?;
    let second = c.secret("Repeat new PIN: ")?;
    if *first != *second {
        return Err(CliError::Usage("the two PIN entries do not match".into()));
    }
    Ok(first)
}

/// Ask for a typed confirmation word. Non-interactive runs are refused unless `yes` was given.
fn confirm_word(c: &mut dyn Console, yes: bool, word: &str, what: &str) -> Result<(), CliError> {
    if yes {
        return Ok(());
    }
    if !c.interactive() {
        return Err(CliError::Usage(format!(
            "{what} needs an interactive terminal, or --yes to proceed without asking"
        )));
    }
    let answer = c.line(&format!("Type '{word}' to continue: "))?;
    if answer.trim() == word {
        Ok(())
    } else {
        Err(CliError::Cancelled)
    }
}

pub fn pin_set(a: &dyn Authenticator, c: &mut dyn Console, yes: bool, pin_stdin: bool) -> Res {
    if pin_stdin && !yes {
        return Err(CliError::Usage(
            "--pin-stdin requires --yes (there is no prompt to confirm on)".into(),
        ));
    }
    // Decide from the device state before any PIN is read.
    match a.pin_status()?.client_pin {
        PinState::Unsupported => {
            return Err(CliError::Usage(
                "this authenticator does not support a FIDO PIN".into(),
            ));
        }
        PinState::Set => {
            return Err(CliError::Usage(
                "a PIN is already set; use `multikey fido pin change`".into(),
            ));
        }
        PinState::NotSet => {}
    }
    writeln!(c.err(), "{PIN_SET_WARNING}").map_err(msg)?;
    confirm_word(c, yes, "set pin", "setting a PIN")?;
    let pin = read_new_pin(c, "New FIDO PIN: ", pin_stdin)?;
    a.set_pin(&pin)?;
    writeln!(
        c.out(),
        "FIDO PIN set and verified (clientPin is now true)."
    )
    .map_err(msg)?;
    Ok(())
}

pub fn pin_change(a: &dyn Authenticator, c: &mut dyn Console, pin_stdin: bool) -> Res {
    match a.pin_status()?.client_pin {
        PinState::Unsupported => {
            return Err(CliError::Usage(
                "this authenticator does not support a FIDO PIN".into(),
            ));
        }
        PinState::NotSet => {
            return Err(CliError::Usage(
                "no PIN is set; use `multikey fido pin set`".into(),
            ))
        }
        PinState::Set => {}
    }
    let (current, new) = if pin_stdin {
        (c.stdin_secret()?, c.stdin_secret()?)
    } else {
        let current = c.secret("Current FIDO PIN: ")?;
        let new = read_new_pin(c, "New FIDO PIN: ", false)?;
        (current, new)
    };
    // One attempt only: a wrong PIN costs a retry and is never retried automatically.
    a.change_pin(&current, &new)?;
    writeln!(c.out(), "FIDO PIN changed.").map_err(msg)?;
    Ok(())
}

/// Read the existing PIN: prompt without echo, or one line of stdin with `--pin-stdin`.
fn read_pin(c: &mut dyn Console, pin_stdin: bool) -> Result<Zeroizing<String>, CliError> {
    if pin_stdin {
        c.stdin_secret()
    } else {
        c.secret("FIDO PIN: ")
    }
}

pub fn creds_list(a: &dyn Authenticator, c: &mut dyn Console, json: bool, pin_stdin: bool) -> Res {
    let pin = read_pin(c, pin_stdin)?;
    let creds: Vec<CredEntry> = a.list_credentials(&pin)?;
    emit(c.out(), json, &creds, |w| {
        if creds.is_empty() {
            return writeln!(w, "(no discoverable credentials)");
        }
        for e in &creds {
            writeln!(
                w,
                "{}\t{}\t{}\t{}",
                e.rp_id, e.user_name, e.user_display_name, e.credential_id
            )?;
        }
        Ok(())
    })
}

pub fn creds_delete(
    a: &dyn Authenticator,
    c: &mut dyn Console,
    id: &str,
    yes: bool,
    pin_stdin: bool,
) -> Res {
    if pin_stdin && !yes {
        return Err(CliError::Usage(
            "--pin-stdin requires --yes (there is no prompt to confirm on)".into(),
        ));
    }
    let pin = read_pin(c, pin_stdin)?;
    let want = id.to_ascii_lowercase();
    let creds = a.list_credentials(&pin)?;
    let Some(hit) = creds.iter().find(|e| e.credential_id == want) else {
        return Err(FidoError::NotFound.into());
    };
    writeln!(
        c.err(),
        "Credential for {} (user {:?}, {:?}) will be deleted. This cannot be undone.",
        hit.rp_id,
        hit.user_name,
        hit.user_display_name
    )
    .map_err(msg)?;
    confirm_word(c, yes, "delete", "deleting a credential")?;
    a.delete_credential(&pin, &want)?;
    writeln!(c.out(), "deleted and verified absent: {want}").map_err(msg)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::console::testing::TestConsole;
    use multikey_fido::mock::MockAuthenticator;

    const SECRET: &str = "s3cr3t-PIN-9137";

    fn cred(id: &str) -> CredEntry {
        CredEntry {
            rp_id: "example.org".into(),
            credential_id: id.into(),
            user_name: "alice".into(),
            user_display_name: "Alice".into(),
        }
    }

    #[test]
    fn pin_set_already_set_exits_before_prompting() {
        let m = MockAuthenticator::with_pin("1234");
        let mut c = TestConsole::interactive();
        let r = pin_set(&m, &mut c, false, false);
        assert!(matches!(r, Err(CliError::Usage(_))));
        assert_eq!(crate::error::exit_code(&r.unwrap_err()), 2);
        assert!(
            !c.everything().contains("New FIDO PIN"),
            "no prompt before the state check"
        );
        assert!(!m.state.borrow().calls.contains(&"set_pin"));
    }

    #[test]
    fn pin_set_requires_typed_confirmation() {
        let m = MockAuthenticator::default();
        let mut c = TestConsole::interactive();
        c.lines.push_back("yes".into());
        c.secrets.extend([SECRET.to_string(), SECRET.to_string()]);
        assert!(matches!(
            pin_set(&m, &mut c, false, false),
            Err(CliError::Cancelled)
        ));
        assert!(m.state.borrow().pin.is_none());
        assert!(c.everything().contains("authenticatorReset"));
    }

    #[test]
    fn pin_set_happy_path_never_prints_pin() {
        let m = MockAuthenticator::default();
        let mut c = TestConsole::interactive();
        c.lines.push_back("set pin".into());
        c.secrets.extend([SECRET.to_string(), SECRET.to_string()]);
        pin_set(&m, &mut c, false, false).unwrap();
        assert_eq!(m.state.borrow().pin.as_deref(), Some(SECRET));
        assert!(!c.everything().contains(SECRET));
    }

    #[test]
    fn pin_set_mismatch_does_not_set() {
        let m = MockAuthenticator::default();
        let mut c = TestConsole::interactive();
        c.lines.push_back("set pin".into());
        c.secrets
            .extend([SECRET.to_string(), "other-pin".to_string()]);
        assert!(matches!(
            pin_set(&m, &mut c, false, false),
            Err(CliError::Usage(_))
        ));
        assert!(m.state.borrow().pin.is_none());
        assert!(!c.everything().contains(SECRET));
    }

    #[test]
    fn pin_set_noninteractive_needs_yes() {
        let m = MockAuthenticator::default();
        let mut c = TestConsole::default();
        assert!(matches!(
            pin_set(&m, &mut c, false, false),
            Err(CliError::Usage(_))
        ));
        assert!(m.state.borrow().pin.is_none());
    }

    #[test]
    fn pin_stdin_needs_yes_and_works_with_it() {
        let m = MockAuthenticator::default();
        let mut c = TestConsole::default();
        c.stdin.push_back(SECRET.to_string());
        assert!(matches!(
            pin_set(&m, &mut c, false, true),
            Err(CliError::Usage(_))
        ));
        pin_set(&m, &mut c, true, true).unwrap();
        assert_eq!(m.state.borrow().pin.as_deref(), Some(SECRET));
        assert!(!c.everything().contains(SECRET));
    }

    #[test]
    fn pin_change_wrong_pin_reports_retries_without_leaking() {
        let m = MockAuthenticator::with_pin(SECRET);
        let mut c = TestConsole::interactive();
        c.secrets.extend([
            "wrong-PIN-0000".to_string(),
            "new-PIN-4242".to_string(),
            "new-PIN-4242".to_string(),
        ]);
        let e = pin_change(&m, &mut c, false).unwrap_err();
        assert_eq!(crate::error::exit_code(&e), 5);
        assert!(crate::error::message(&e).contains("7 attempts left"));
        assert_eq!(m.state.borrow().pin.as_deref(), Some(SECRET));
        assert_eq!(
            m.state
                .borrow()
                .calls
                .iter()
                .filter(|x| **x == "change_pin")
                .count(),
            1,
            "no automatic retry"
        );
        let all = format!("{}{}", c.everything(), crate::error::message(&e));
        for p in [SECRET, "wrong-PIN-0000", "new-PIN-4242"] {
            assert!(!all.contains(p));
        }
    }

    #[test]
    fn pin_change_happy_path() {
        let m = MockAuthenticator::with_pin(SECRET);
        let mut c = TestConsole::interactive();
        c.secrets.extend([
            SECRET.to_string(),
            "new-PIN-4242".to_string(),
            "new-PIN-4242".to_string(),
        ]);
        pin_change(&m, &mut c, false).unwrap();
        assert_eq!(m.state.borrow().pin.as_deref(), Some("new-PIN-4242"));
    }

    #[test]
    fn creds_list_json_and_no_pin_in_output() {
        let m = MockAuthenticator::with_pin(SECRET);
        m.state.borrow_mut().credentials.push(cred("aabb"));
        let mut c = TestConsole::interactive();
        c.secrets.push_back(SECRET.to_string());
        creds_list(&m, &mut c, true, false).unwrap();
        let v: serde_json::Value = serde_json::from_str(&c.stdout()).unwrap();
        assert_eq!(v[0]["credential_id"], "aabb");
        assert_eq!(v[0]["rp_id"], "example.org");
        assert!(!c.everything().contains(SECRET));
    }

    #[test]
    fn creds_delete_needs_typed_word_and_verifies() {
        let m = MockAuthenticator::with_pin(SECRET);
        m.state.borrow_mut().credentials.push(cred("aabb"));
        let mut c = TestConsole::interactive();
        c.secrets.push_back(SECRET.to_string());
        c.lines.push_back("no".into());
        assert!(matches!(
            creds_delete(&m, &mut c, "AABB", false, false),
            Err(CliError::Cancelled)
        ));
        assert_eq!(m.state.borrow().credentials.len(), 1);

        let mut c = TestConsole::interactive();
        c.secrets.push_back(SECRET.to_string());
        c.lines.push_back("delete".into());
        creds_delete(&m, &mut c, "AABB", false, false).unwrap();
        assert!(m.state.borrow().credentials.is_empty());
        assert!(c.stdout().contains("verified absent"));
        assert!(!c.everything().contains(SECRET));
    }

    #[test]
    fn creds_delete_unknown_id_is_not_found() {
        let m = MockAuthenticator::with_pin(SECRET);
        let mut c = TestConsole::interactive();
        c.secrets.push_back(SECRET.to_string());
        let e = creds_delete(&m, &mut c, "ff", true, false).unwrap_err();
        assert!(matches!(e, CliError::Fido(FidoError::NotFound)));
    }

    #[test]
    fn creds_pin_stdin_list_and_delete() {
        let m = MockAuthenticator::with_pin(SECRET);
        m.state.borrow_mut().credentials.push(cred("aabb"));
        let mut c = TestConsole::default();
        c.stdin.push_back(SECRET.to_string());
        creds_list(&m, &mut c, false, true).unwrap();
        assert!(c.stdout().contains("aabb"));
        // --pin-stdin without --yes is refused before anything is read
        let mut c = TestConsole::default();
        c.stdin.push_back(SECRET.to_string());
        assert!(matches!(
            creds_delete(&m, &mut c, "aabb", false, true),
            Err(CliError::Usage(_))
        ));
        assert_eq!(m.state.borrow().credentials.len(), 1);
        creds_delete(&m, &mut c, "aabb", true, true).unwrap();
        assert!(m.state.borrow().credentials.is_empty());
        assert!(!c.everything().contains(SECRET));
    }

    #[test]
    fn pin_status_json_fields() {
        let m = MockAuthenticator::with_pin("1234");
        let mut c = TestConsole::default();
        pin_status(&m, &mut c, true).unwrap();
        let v: serde_json::Value = serde_json::from_str(&c.stdout()).unwrap();
        assert_eq!(v["client_pin"], "set");
        assert_eq!(v["retries"], 8);
        assert_eq!(v["make_cred_uv_not_rqd"], true);
        assert_eq!(v["cred_mgmt"], true);

        let m = MockAuthenticator::default();
        let mut c = TestConsole::default();
        pin_status(&m, &mut c, true).unwrap();
        let v: serde_json::Value = serde_json::from_str(&c.stdout()).unwrap();
        assert_eq!(v["client_pin"], "not_set");
        assert!(v["retries"].is_null());
    }

    #[test]
    fn info_json_fields() {
        let m = MockAuthenticator::default();
        let mut c = TestConsole::default();
        info(&m, &mut c, true).unwrap();
        let v: serde_json::Value = serde_json::from_str(&c.stdout()).unwrap();
        assert_eq!(v["aaguid"], "0a63b9948ba65e749e5a0f894cc35c4d");
        assert!(v["versions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x == "FIDO_2_1"));
    }
}
