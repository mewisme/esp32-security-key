//! Terminal interaction behind a trait so the PIN flows can be tested without a terminal.

use std::io::{self, BufRead, IsTerminal, Write};

use zeroize::Zeroizing;

use crate::error::{msg, CliError};

pub trait Console {
    fn out(&mut self) -> &mut dyn Write;
    fn err(&mut self) -> &mut dyn Write;
    /// Prompt without echo.
    fn secret(&mut self, prompt: &str) -> Result<Zeroizing<String>, CliError>;
    /// Prompt for a visible line. EOF is `Cancelled`.
    fn line(&mut self, prompt: &str) -> Result<String, CliError>;
    /// One line of standard input, for `--pin-stdin`. EOF is `Cancelled`.
    fn stdin_secret(&mut self) -> Result<Zeroizing<String>, CliError>;
    fn interactive(&self) -> bool;
}

pub struct RealConsole {
    out: io::Stdout,
    err: io::Stderr,
}

impl RealConsole {
    pub fn new() -> Self {
        Self {
            out: io::stdout(),
            err: io::stderr(),
        }
    }
}

fn read_stdin_line() -> Result<Zeroizing<String>, CliError> {
    let mut s = Zeroizing::new(String::new());
    let n = io::stdin().lock().read_line(&mut s).map_err(msg)?;
    if n == 0 {
        return Err(CliError::Cancelled);
    }
    while s.ends_with('\n') || s.ends_with('\r') {
        s.pop();
    }
    Ok(s)
}

impl Console for RealConsole {
    fn out(&mut self) -> &mut dyn Write {
        &mut self.out
    }
    fn err(&mut self) -> &mut dyn Write {
        &mut self.err
    }
    fn secret(&mut self, prompt: &str) -> Result<Zeroizing<String>, CliError> {
        rpassword::prompt_password(prompt)
            .map(Zeroizing::new)
            .map_err(msg)
    }
    fn line(&mut self, prompt: &str) -> Result<String, CliError> {
        eprint!("{prompt}");
        let _ = io::stderr().flush();
        read_stdin_line().map(|z| z.to_string())
    }
    fn stdin_secret(&mut self) -> Result<Zeroizing<String>, CliError> {
        read_stdin_line()
    }
    fn interactive(&self) -> bool {
        io::stdin().is_terminal()
    }
}

#[cfg(test)]
pub mod testing {
    use super::*;
    use std::collections::VecDeque;

    /// Scripted console that records everything written to stdout/stderr.
    #[derive(Default)]
    pub struct TestConsole {
        pub out: Vec<u8>,
        pub err: Vec<u8>,
        pub secrets: VecDeque<String>,
        pub lines: VecDeque<String>,
        pub stdin: VecDeque<String>,
        pub tty: bool,
    }

    impl TestConsole {
        pub fn interactive() -> Self {
            Self {
                tty: true,
                ..Self::default()
            }
        }
        pub fn everything(&self) -> String {
            format!(
                "{}{}",
                String::from_utf8_lossy(&self.out),
                String::from_utf8_lossy(&self.err)
            )
        }
        pub fn stdout(&self) -> String {
            String::from_utf8_lossy(&self.out).into_owned()
        }
    }

    impl Console for TestConsole {
        fn out(&mut self) -> &mut dyn Write {
            &mut self.out
        }
        fn err(&mut self) -> &mut dyn Write {
            &mut self.err
        }
        fn secret(&mut self, prompt: &str) -> Result<Zeroizing<String>, CliError> {
            self.err.extend_from_slice(prompt.as_bytes());
            self.secrets
                .pop_front()
                .map(Zeroizing::new)
                .ok_or(CliError::Cancelled)
        }
        fn line(&mut self, prompt: &str) -> Result<String, CliError> {
            self.err.extend_from_slice(prompt.as_bytes());
            self.lines.pop_front().ok_or(CliError::Cancelled)
        }
        fn stdin_secret(&mut self) -> Result<Zeroizing<String>, CliError> {
            self.stdin
                .pop_front()
                .map(Zeroizing::new)
                .ok_or(CliError::Cancelled)
        }
        fn interactive(&self) -> bool {
            self.tty
        }
    }
}
