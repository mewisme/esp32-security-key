//! `multikey` command line tool.
//!
//! Exit codes: 0 ok, 1 failure, 2 usage / ambiguous selection / refused by policy, 3 no device or PC/SC/HID
//! unavailable, 4 user-presence timeout or denied, 5 wrong PIN, 6 PIN blocked, 130 cancelled at a prompt.

mod cmd_device;
mod cmd_fido;
mod cmd_mkauth;
mod console;
mod error;
mod output;
mod select;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};
use multikey_fido::{Authenticator, HidAuthenticator};
use multikey_host::default_trust_store_path;

use cmd_mkauth::Opener;
use console::{Console, RealConsole};
use error::{exit_code, message, CliError, Res};
use select::{pick_live, Need, SelectArgs};

const EXIT_HELP: &str = "\
Exit codes: 0 ok, 1 failure, 2 usage / ambiguous device selection / refused, 3 no device or PC/SC or HID
unavailable, 4 button not pressed in time, 5 wrong PIN, 6 PIN blocked, 130 cancelled at a prompt.

With several keys attached, `device`, `fido` and `mkauth` commands refuse to guess: pick one with
--device N (see `multikey device list`), --reader TEXT or --hid-path PATH.";

#[derive(Parser)]
#[command(name = "multikey", version, about = "MultiKey host tool", after_help = EXIT_HELP)]
struct Cli {
    /// Machine-readable JSON on stdout (read-only commands only).
    #[arg(long, global = true)]
    json: bool,
    /// Device number from `multikey device list`.
    #[arg(long, global = true, value_name = "N")]
    device: Option<usize>,
    /// Smart-card reader name (substring match, case-insensitive).
    #[arg(long, global = true, value_name = "TEXT")]
    reader: Option<String>,
    /// FIDO HID path as printed by `multikey device list`.
    #[arg(long, global = true, value_name = "PATH")]
    hid_path: Option<String>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Args)]
struct Common {
    /// Trust store path.
    #[arg(long, value_name = "PATH")]
    trust_store: Option<PathBuf>,
}

impl Common {
    fn store_path(&self) -> PathBuf {
        self.trust_store
            .clone()
            .unwrap_or_else(default_trust_store_path)
    }
}

#[derive(Subcommand)]
enum Cmd {
    /// List PC/SC readers.
    Readers,
    /// Inspect the key and manage its name.
    Device {
        #[command(subcommand)]
        cmd: DeviceCmd,
    },
    /// FIDO2: authenticator info, FIDO PIN and credential management.
    Fido {
        #[command(subcommand)]
        cmd: FidoCmd,
    },
    /// MKAUTH applet: enroll, authenticate, revoke (PAM login key). Separate from FIDO.
    Mkauth {
        #[command(subcommand)]
        cmd: MkauthCmd,
    },
    /// Legacy alias of `mkauth status`.
    #[command(hide = true)]
    Status,
    /// Legacy alias of `mkauth enroll`.
    #[command(hide = true)]
    Enroll {
        #[arg(long)]
        user: String,
        #[command(flatten)]
        common: Common,
        #[arg(long)]
        yes: bool,
    },
    /// Legacy alias of `mkauth auth`.
    #[command(hide = true)]
    Auth {
        #[arg(long)]
        user: String,
        #[command(flatten)]
        common: Common,
        #[arg(long, default_value_t = 30)]
        timeout: u64,
    },
    /// Legacy alias of `mkauth list`.
    #[command(hide = true)]
    List {
        #[command(flatten)]
        common: Common,
    },
    /// Legacy alias of `mkauth revoke`.
    #[command(hide = true)]
    Revoke {
        #[arg(long)]
        user: String,
        #[command(flatten)]
        common: Common,
    },
}

#[derive(Subcommand)]
enum DeviceCmd {
    /// List MultiKeys devices (FIDO HID and smart-card interfaces, paired when unambiguous).
    List,
    /// Name, MKAUTH state, FIDO info and USB identity of one device.
    Info,
    /// MKAUTH enrollment state and FIDO PIN state of one device.
    Status,
    /// Tool, protocol and CTAP versions (the firmware has no build identifier).
    Version,
    /// Show the device name and whether a rename is waiting for USB re-enumeration.
    Show,
    /// Store a new device name (button press; also the MKAUTH PIN once enrolled). 1-31 printable ASCII
    /// characters. Keys, credentials, PINs, VID/PID and the FIDO AAGUID are not touched.
    Rename {
        /// New name, e.g. "Mew's Security Key".
        name: String,
        /// Detach/attach USB right away so the host reads the new name (the reader reappears).
        #[arg(long)]
        reenumerate: bool,
    },
    /// Restore the default name from the firmware build (same authorization as rename).
    ResetName {
        #[arg(long)]
        reenumerate: bool,
    },
    /// Detach/attach USB so the host re-reads the name (button press; PIN once enrolled).
    Reenumerate,
}

#[derive(Subcommand)]
enum FidoCmd {
    /// authenticatorGetInfo: versions, AAGUID, options, extensions.
    Info,
    /// FIDO PIN.
    Pin {
        #[command(subcommand)]
        cmd: PinCmd,
    },
    /// Discoverable (resident) credentials; needs the FIDO PIN.
    Credentials {
        #[command(subcommand)]
        cmd: CredCmd,
    },
}

#[derive(Subcommand)]
enum PinCmd {
    /// Whether a PIN is set and how many attempts remain.
    Status,
    /// Set the first FIDO PIN. IRREVERSIBLE without authenticatorReset: ends touch-only use on this firmware.
    Set {
        /// Skip the typed confirmation (required with --pin-stdin or without a terminal).
        #[arg(long)]
        yes: bool,
        /// Read the new PIN as one line from standard input instead of prompting.
        #[arg(long)]
        pin_stdin: bool,
    },
    /// Change the FIDO PIN (one attempt; a wrong PIN costs a retry).
    Change {
        /// Read the current and then the new PIN as two lines from standard input.
        #[arg(long)]
        pin_stdin: bool,
    },
}

#[derive(Subcommand)]
enum CredCmd {
    /// List discoverable credentials (asks for the PIN).
    List {
        /// Read the PIN as one line from standard input instead of prompting.
        #[arg(long)]
        pin_stdin: bool,
    },
    /// Delete one credential by id (asks for the PIN, then for confirmation).
    Delete {
        /// Credential id in hex, from `credentials list`.
        #[arg(long)]
        id: String,
        /// Skip the typed confirmation.
        #[arg(long)]
        yes: bool,
        /// Read the PIN as one line from standard input instead of prompting (requires --yes).
        #[arg(long)]
        pin_stdin: bool,
    },
}

#[derive(Subcommand)]
enum MkauthCmd {
    /// MKAUTH applet state.
    Status,
    /// Enroll the device (sets the MKAUTH PIN, creates a key) and add it to the trust store.
    Enroll {
        #[arg(long)]
        user: String,
        #[command(flatten)]
        common: Common,
        /// Write the trust store without asking for confirmation.
        #[arg(long)]
        yes: bool,
    },
    /// Authenticate a user with the device.
    Auth {
        #[arg(long)]
        user: String,
        #[command(flatten)]
        common: Common,
        /// Overall timeout in seconds.
        #[arg(long, default_value_t = 30)]
        timeout: u64,
    },
    /// List trust store entries.
    List {
        #[command(flatten)]
        common: Common,
    },
    /// Delete the device key (PIN + button) and remove the trust store entry.
    Revoke {
        #[arg(long)]
        user: String,
        #[command(flatten)]
        common: Common,
    },
}

/// Commands that print machine-readable output. `--json` on anything else is refused.
fn supports_json(cmd: &Cmd) -> bool {
    match cmd {
        Cmd::Readers | Cmd::Status | Cmd::List { .. } => true,
        Cmd::Device { cmd } => matches!(
            cmd,
            DeviceCmd::List | DeviceCmd::Info | DeviceCmd::Status | DeviceCmd::Version
        ),
        Cmd::Fido { cmd } => match cmd {
            FidoCmd::Info => true,
            FidoCmd::Pin { cmd } => matches!(cmd, PinCmd::Status),
            FidoCmd::Credentials { cmd } => matches!(cmd, CredCmd::List { .. }),
        },
        Cmd::Mkauth { cmd } => matches!(cmd, MkauthCmd::Status | MkauthCmd::List { .. }),
        Cmd::Enroll { .. } | Cmd::Auth { .. } | Cmd::Revoke { .. } => false,
    }
}

fn open_fido(args: &SelectArgs) -> Result<HidAuthenticator, CliError> {
    // An explicit path is honored even when the device is not recognised as a MultiKeys key (custom VID/PID).
    if let Some(p) = &args.hid_path {
        return Ok(HidAuthenticator::open(p)?);
    }
    let found =
        pick_live(args, Need::Hid).and_then(|e| e.hid.ok_or(multikey_host::Error::NoDevice.into()));
    match found {
        Ok(hid) => Ok(HidAuthenticator::open(&hid.path)?),
        Err(e) => {
            if matches!(e, CliError::Host(multikey_host::Error::NoDevice)) {
                eprintln!("{}", cmd_device::WINDOWS_HID_HINT);
            }
            Err(e)
        }
    }
}

fn run(cli: Cli, c: &mut dyn Console) -> Res {
    if cli.json && !supports_json(&cli.cmd) {
        return Err(CliError::Usage(
            "--json is not supported for this command (read-only commands only)".into(),
        ));
    }
    let sel = SelectArgs {
        device: cli.device,
        reader: cli.reader.clone(),
        hid_path: cli.hid_path.clone(),
    };
    let json = cli.json;
    let strict = || Opener::Strict(sel.clone());
    // Legacy top-level commands keep first-match reader selection and know only --reader.
    let legacy = |what: &str| -> Result<Opener, CliError> {
        if cli.device.is_some() || cli.hid_path.is_some() {
            return Err(CliError::Usage(format!("`{what}` takes only --reader; use `multikey mkauth {what}` for --device/--hid-path")));
        }
        Ok(Opener::Legacy(cli.reader.clone()))
    };
    match cli.cmd {
        Cmd::Readers => {
            let r = multikey_host::list_readers()?;
            output::emit(c.out(), json, &r, |w| {
                if r.is_empty() {
                    writeln!(w, "(no readers)")?;
                }
                for n in &r {
                    writeln!(w, "{n}")?;
                }
                Ok(())
            })
        }
        Cmd::Device { cmd } => match cmd {
            DeviceCmd::List => cmd_device::list(c, json),
            DeviceCmd::Info => cmd_device::info(c, &sel, json),
            DeviceCmd::Status => cmd_device::status(c, &sel, json),
            DeviceCmd::Version => cmd_device::version(c, &sel, json),
            DeviceCmd::Show => cmd_device::show(&strict(), c),
            DeviceCmd::Rename { name, reenumerate } => {
                cmd_device::rename(&strict(), c, &name, reenumerate)
            }
            DeviceCmd::ResetName { reenumerate } => {
                cmd_device::reset_name(&strict(), c, reenumerate)
            }
            DeviceCmd::Reenumerate => cmd_device::reenumerate(&strict(), c),
        },
        Cmd::Fido { cmd } => {
            let a = open_fido(&sel)?;
            run_fido(cmd, &a, c, json)
        }
        Cmd::Mkauth { cmd } => match cmd {
            MkauthCmd::Status => cmd_mkauth::status(&strict(), c, json),
            MkauthCmd::Enroll { user, common, yes } => {
                cmd_mkauth::enroll(&strict(), c, &user, common.store_path(), yes)
            }
            MkauthCmd::Auth {
                user,
                common,
                timeout,
            } => cmd_mkauth::auth(&strict(), c, &user, common.store_path(), timeout),
            MkauthCmd::List { common } => cmd_mkauth::list(c, common.store_path(), json),
            MkauthCmd::Revoke { user, common } => {
                cmd_mkauth::revoke(&strict(), c, &user, common.store_path())
            }
        },
        Cmd::Status => cmd_mkauth::status(&legacy("status")?, c, json),
        Cmd::Enroll { user, common, yes } => {
            cmd_mkauth::enroll(&legacy("enroll")?, c, &user, common.store_path(), yes)
        }
        Cmd::Auth {
            user,
            common,
            timeout,
        } => cmd_mkauth::auth(&legacy("auth")?, c, &user, common.store_path(), timeout),
        Cmd::List { common } => cmd_mkauth::list(c, common.store_path(), json),
        Cmd::Revoke { user, common } => {
            cmd_mkauth::revoke(&legacy("revoke")?, c, &user, common.store_path())
        }
    }
}

fn run_fido(cmd: FidoCmd, a: &dyn Authenticator, c: &mut dyn Console, json: bool) -> Res {
    match cmd {
        FidoCmd::Info => cmd_fido::info(a, c, json),
        FidoCmd::Pin { cmd } => match cmd {
            PinCmd::Status => cmd_fido::pin_status(a, c, json),
            PinCmd::Set { yes, pin_stdin } => cmd_fido::pin_set(a, c, yes, pin_stdin),
            PinCmd::Change { pin_stdin } => cmd_fido::pin_change(a, c, pin_stdin),
        },
        FidoCmd::Credentials { cmd } => match cmd {
            CredCmd::List { pin_stdin } => cmd_fido::creds_list(a, c, json, pin_stdin),
            CredCmd::Delete { id, yes, pin_stdin } => {
                cmd_fido::creds_delete(a, c, &id, yes, pin_stdin)
            }
        },
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let mut console = RealConsole::new();
    match run(cli, &mut console) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {}", message(&e));
            ExitCode::from(exit_code(&e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::console::testing::TestConsole;
    use clap::CommandFactory;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("multikey").chain(args.iter().copied()))
    }

    #[test]
    fn clap_definition_is_consistent() {
        Cli::command().debug_assert();
    }

    #[test]
    fn version_flag_prints_tool_name_and_version() {
        let e = parse(&["--version"]).err().unwrap();
        assert_eq!(
            e.to_string().trim(),
            format!("multikey {}", env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn command_matrix_parses() {
        for args in [
            &["readers"][..],
            &["device", "list"],
            &["device", "info"],
            &["device", "status"],
            &["device", "version"],
            &["device", "show"],
            &["device", "rename", "My Key", "--reenumerate"],
            &["device", "reset-name"],
            &["device", "reenumerate"],
            &["fido", "info"],
            &["fido", "pin", "status"],
            &["fido", "pin", "set", "--yes", "--pin-stdin"],
            &["fido", "pin", "change"],
            &["fido", "credentials", "list", "--pin-stdin"],
            &[
                "fido",
                "credentials",
                "delete",
                "--id",
                "aabb",
                "--yes",
                "--pin-stdin",
            ],
            &["mkauth", "status"],
            &["mkauth", "enroll", "--user", "u", "--yes"],
            &["mkauth", "auth", "--user", "u", "--timeout", "5"],
            &["mkauth", "list"],
            &["mkauth", "revoke", "--user", "u"],
            // legacy aliases still parse
            &["status"],
            &["enroll", "--user", "u"],
            &["auth", "--user", "u", "--reader", "x"],
            &["list"],
            &["revoke", "--user", "u"],
            // global selection flags are accepted anywhere
            &["fido", "info", "--device", "1"],
            &["--device", "1", "device", "info", "--json"],
        ] {
            parse(args).unwrap_or_else(|e| panic!("{args:?}: {e}"));
        }
    }

    #[test]
    fn json_only_for_read_only_commands() {
        let ok = |a: &[&str]| supports_json(&parse(a).unwrap().cmd);
        assert!(ok(&["readers"]));
        assert!(ok(&["device", "list"]));
        assert!(ok(&["device", "info"]));
        assert!(ok(&["fido", "pin", "status"]));
        assert!(ok(&["fido", "credentials", "list"]));
        assert!(ok(&["mkauth", "list"]));
        assert!(ok(&["status"]));
        assert!(!ok(&["device", "rename", "x"]));
        assert!(!ok(&["fido", "pin", "set"]));
        assert!(!ok(&["fido", "pin", "change"]));
        assert!(!ok(&["fido", "credentials", "delete", "--id", "aa"]));
        assert!(!ok(&["mkauth", "enroll", "--user", "u"]));
        assert!(!ok(&["mkauth", "revoke", "--user", "u"]));
        assert!(!ok(&["revoke", "--user", "u"]));
    }

    #[test]
    fn json_on_mutating_command_exits_2_before_touching_anything() {
        let cli = parse(&["--json", "fido", "pin", "set"]).unwrap();
        let mut c = TestConsole::default();
        let e = run(cli, &mut c).unwrap_err();
        assert_eq!(exit_code(&e), 2);
        assert!(c.everything().is_empty());
    }

    #[test]
    fn legacy_command_rejects_device_selection() {
        let cli = parse(&["status", "--device", "0"]).unwrap();
        let mut c = TestConsole::default();
        assert_eq!(exit_code(&run(cli, &mut c).unwrap_err()), 2);
    }
}
