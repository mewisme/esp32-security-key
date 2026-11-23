//! CLI error type and the exit-code contract.
//!
//! 0 ok, 1 failure, 2 usage / ambiguous selection / refused by policy, 3 no device or PC/SC/HID unavailable,
//! 4 user-presence timeout or denied, 5 wrong PIN, 6 PIN blocked, 130 cancelled at a prompt.

use multikey_fido::FidoError;
use multikey_host::Error;

pub const EXIT_FAILURE: u8 = 1;
pub const EXIT_USAGE: u8 = 2;
pub const EXIT_NO_DEVICE: u8 = 3;
pub const EXIT_NO_PRESENCE: u8 = 4;
pub const EXIT_PIN_WRONG: u8 = 5;
pub const EXIT_PIN_BLOCKED: u8 = 6;
pub const EXIT_CANCELLED: u8 = 130;

#[derive(Debug)]
pub enum CliError {
    Host(Error),
    Fido(FidoError),
    /// Bad invocation or an operation refused before anything was sent.
    Usage(String),
    Msg(String),
    /// EOF or a declined confirmation at a prompt; nothing was changed.
    Cancelled,
}

pub type Res = Result<(), CliError>;

impl From<Error> for CliError {
    fn from(e: Error) -> Self {
        Self::Host(e)
    }
}

impl From<FidoError> for CliError {
    fn from(e: FidoError) -> Self {
        Self::Fido(e)
    }
}

pub fn msg<E: std::fmt::Display>(e: E) -> CliError {
    CliError::Msg(e.to_string())
}

pub fn exit_code(e: &CliError) -> u8 {
    match e {
        CliError::Usage(_) => EXIT_USAGE,
        CliError::Msg(_) => EXIT_FAILURE,
        CliError::Cancelled => EXIT_CANCELLED,
        CliError::Host(h) => match h {
            Error::NoDevice | Error::NoService(_) => EXIT_NO_DEVICE,
            Error::Ambiguous(_) => EXIT_USAGE,
            Error::NoUserPresence => EXIT_NO_PRESENCE,
            Error::PinRetries(_) => EXIT_PIN_WRONG,
            Error::PinBlocked => EXIT_PIN_BLOCKED,
            _ => EXIT_FAILURE,
        },
        CliError::Fido(f) => match f {
            FidoError::NoDevice => EXIT_NO_DEVICE,
            FidoError::Ambiguous
            | FidoError::Unsupported(_)
            | FidoError::PinNotSet
            | FidoError::PinPolicy(_) => EXIT_USAGE,
            FidoError::NoUserPresence => EXIT_NO_PRESENCE,
            FidoError::PinInvalid { .. } => EXIT_PIN_WRONG,
            FidoError::PinBlocked | FidoError::PinAuthBlocked => EXIT_PIN_BLOCKED,
            FidoError::Cancelled => EXIT_CANCELLED,
            FidoError::NotFound | FidoError::Transport(_) | FidoError::Other(_) => EXIT_FAILURE,
        },
    }
}

pub fn message(e: &CliError) -> String {
    match e {
        CliError::Usage(m) | CliError::Msg(m) => m.clone(),
        CliError::Cancelled => "cancelled; nothing was changed".to_string(),
        CliError::Host(h) => h.to_string(),
        CliError::Fido(f) => {
            let mut s = f.to_string();
            if let FidoError::PinInvalid { retries: Some(r) } = f {
                if *r <= 3 {
                    s.push_str(&format!(
                        ". Warning: only {r} more wrong attempts are allowed; after that the PIN is blocked and only authenticatorReset (deleting every credential) recovers the key."
                    ));
                }
            }
            s
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_code_table() {
        assert_eq!(exit_code(&CliError::Usage("x".into())), 2);
        assert_eq!(exit_code(&CliError::Msg("x".into())), 1);
        assert_eq!(exit_code(&CliError::Cancelled), 130);
        assert_eq!(exit_code(&CliError::Host(Error::NoDevice)), 3);
        assert_eq!(exit_code(&CliError::Host(Error::Ambiguous(vec![]))), 2);
        assert_eq!(exit_code(&CliError::Host(Error::NoUserPresence)), 4);
        assert_eq!(exit_code(&CliError::Host(Error::PinRetries(3))), 5);
        assert_eq!(exit_code(&CliError::Host(Error::PinBlocked)), 6);
        assert_eq!(exit_code(&CliError::Fido(FidoError::NoDevice)), 3);
        assert_eq!(
            exit_code(&CliError::Fido(FidoError::PinInvalid { retries: Some(5) })),
            5
        );
        assert_eq!(exit_code(&CliError::Fido(FidoError::PinBlocked)), 6);
        assert_eq!(exit_code(&CliError::Fido(FidoError::PinAuthBlocked)), 6);
        assert_eq!(exit_code(&CliError::Fido(FidoError::NoUserPresence)), 4);
        assert_eq!(exit_code(&CliError::Fido(FidoError::PinNotSet)), 2);
        assert_eq!(exit_code(&CliError::Fido(FidoError::NotFound)), 1);
    }

    #[test]
    fn low_retries_adds_warning() {
        let m = message(&CliError::Fido(FidoError::PinInvalid { retries: Some(2) }));
        assert!(m.contains("2 attempts left") && m.contains("Warning"));
        let m = message(&CliError::Fido(FidoError::PinInvalid { retries: Some(7) }));
        assert!(!m.contains("Warning"));
    }
}
