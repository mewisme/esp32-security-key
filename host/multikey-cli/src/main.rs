//! `multikey` command line tool. Exit codes: 0 ok, 1 failure, 2 usage, 3 no device, 4 user-presence timeout.

use clap::{Args, Parser, Subcommand};
use multikey_host::{
    default_trust_store_path, Device, Error, KeyEntry, PcscTransport, TrustStore, TrustedKey,
};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

const EXIT_FAILURE: u8 = 1;
const EXIT_NO_DEVICE: u8 = 3;
const EXIT_NO_PRESENCE: u8 = 4;

#[derive(Parser)]
#[command(name = "multikey", version, about = "MultiKey MKAUTH v1 host tool")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Args)]
struct Common {
    /// Reader name (substring match). Default: first reader containing "MultiKey" or "ESP32".
    #[arg(long)]
    reader: Option<String>,
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
    /// Show device state.
    Status {
        #[command(flatten)]
        common: Common,
    },
    /// Enroll the device (sets PIN, creates key) and add it to the trust store.
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
    /// Show or change the name the device reports over USB (product string, reader name).
    Device {
        #[command(subcommand)]
        cmd: DeviceCmd,
    },
}

#[derive(Subcommand)]
enum DeviceCmd {
    /// Show the device name and whether a rename is waiting for USB re-enumeration.
    Show {
        #[command(flatten)]
        common: Common,
    },
    /// Store a new device name (button press; also the MKAUTH PIN once enrolled). 1-31 printable ASCII
    /// characters. Keys, credentials, PINs, VID/PID and the FIDO AAGUID are not touched.
    Rename {
        /// New name, e.g. "Mew's Security Key".
        name: String,
        #[command(flatten)]
        common: Common,
        /// Detach/attach USB right away so the host reads the new name (the reader reappears).
        #[arg(long)]
        reenumerate: bool,
    },
    /// Restore the default name from the firmware build (same authorization as rename).
    ResetName {
        #[command(flatten)]
        common: Common,
        #[arg(long)]
        reenumerate: bool,
    },
    /// Detach/attach USB so the host re-reads the name (button press; PIN once enrolled).
    Reenumerate {
        #[command(flatten)]
        common: Common,
    },
}
type Res = Result<(), CliError>;

enum CliError {
    Host(Error),
    Msg(String),
}

impl From<Error> for CliError {
    fn from(e: Error) -> Self {
        Self::Host(e)
    }
}

fn msg<E: std::fmt::Display>(e: E) -> CliError {
    CliError::Msg(e.to_string())
}

fn open(common: &Common) -> Result<Device<PcscTransport>, CliError> {
    let mut d = Device::open(common.reader.as_deref())?;
    d.select()?;
    Ok(d)
}

fn fingerprint(pubkey: &[u8]) -> String {
    let h = Sha256::digest(pubkey);
    h.chunks(2).map(hex::encode).collect::<Vec<_>>().join(":")
}

fn read_pin(prompt: &str) -> Result<Vec<u8>, CliError> {
    rpassword::prompt_password(prompt)
        .map(String::into_bytes)
        .map_err(msg)
}

fn confirm(question: &str) -> bool {
    print!("{question} ");
    let _ = std::io::stdout().flush();
    let mut s = String::new();
    std::io::stdin().read_line(&mut s).is_ok() && s.trim() == "yes"
}

fn run(cli: Cli) -> Res {
    match cli.cmd {
        Cmd::Readers => {
            let r = multikey_host::list_readers()?;
            if r.is_empty() {
                println!("(no readers)");
            }
            for n in r {
                println!("{n}");
            }
            Ok(())
        }
        Cmd::Status { common } => {
            let mut dev = open(&common)?;
            let info = dev.info()?;
            println!("protocol version : {}", info.version);
            println!("enrolled         : {}", info.enrolled);
            println!(
                "policy           : {:#04x} (bit0 = user presence required)",
                info.policy
            );
            println!("device id        : {}", hex::encode(info.device_id));
            if let Some(pk) = info.pubkey {
                println!("public key       : {}", hex::encode(pk));
                println!("fingerprint      : {}", fingerprint(&pk));
            }
            match dev.device_name() {
                Ok(n) => println!(
                    "device name      : {}{}",
                    n.name,
                    if n.custom { " (custom)" } else { " (default)" }
                ),
                Err(Error::NameUnsupported) => {
                    println!("device name      : (firmware without INS 06)")
                }
                Err(e) => return Err(e.into()),
            }
            Ok(())
        }
        Cmd::Enroll { user, common, yes } => {
            let path = common.store_path();
            let mut store = TrustStore::load_or_default(&path).map_err(msg)?;
            if store.find(&user).is_some() {
                return Err(CliError::Msg(format!(
                    "user {user:?} is already in {}",
                    path.display()
                )));
            }
            let mut dev = open(&common)?;
            if dev.info()?.enrolled {
                return Err(Error::AlreadyEnrolled.into());
            }
            let pin = read_pin("New PIN (6-63 characters): ")?;
            if pin != read_pin("Repeat PIN: ")? {
                return Err(CliError::Msg("PINs do not match".into()));
            }
            eprintln!("Press the device button to confirm enrollment...");
            let e = dev.enroll(&pin)?;
            println!("public key  : {}", hex::encode(e.pubkey));
            println!("device id   : {}", hex::encode(e.device_id));
            println!("fingerprint : {}", fingerprint(&e.pubkey));
            if !(yes || confirm(&format!("Trust this key for user {user:?}? Type 'yes':"))) {
                println!(
                    "Trust store NOT written. The device is enrolled; run `multikey revoke` to undo."
                );
                return Ok(());
            }
            store
                .add(KeyEntry::new(&user, &e.pubkey, &e.device_id))
                .map_err(msg)?;
            store.save(&path).map_err(msg)?;
            println!("Wrote {}", path.display());
            Ok(())
        }
        Cmd::Auth {
            user,
            common,
            timeout,
        } => {
            let store = TrustStore::load(&common.store_path()).map_err(msg)?;
            let entry = store
                .find(&user)
                .ok_or_else(|| CliError::Msg(format!("user {user:?} not in trust store")))?;
            let key = TrustedKey::from_entry(entry).map_err(msg)?;
            let mut dev = open(&common)?;
            eprintln!("Press the device button...");
            dev.authenticate(&key, Duration::from_secs(timeout))?;
            println!("authenticated {user}");
            Ok(())
        }
        Cmd::List { common } => {
            let store = TrustStore::load(&common.store_path()).map_err(msg)?;
            for k in store.entries() {
                let (pk, id) = k.decode().map_err(msg)?;
                println!("{}\t{}\t{}", k.user, hex::encode(id), fingerprint(&pk));
            }
            Ok(())
        }
        Cmd::Revoke { user, common } => {
            let path = common.store_path();
            let mut store = TrustStore::load(&path).map_err(msg)?;
            let entry = store
                .find(&user)
                .ok_or_else(|| CliError::Msg(format!("user {user:?} not in trust store")))?;
            let (_, id) = entry.decode().map_err(msg)?;
            let mut dev = open(&common)?;
            let info = dev.info()?;
            if !info.enrolled {
                return Err(Error::NotEnrolled.into());
            }
            if info.device_id != id {
                return Err(Error::DeviceMismatch.into());
            }
            let pin = read_pin("PIN: ")?;
            eprintln!("Press the device button to confirm revocation...");
            dev.revoke(&pin)?;
            store.remove(&user);
            store.save(&path).map_err(msg)?;
            println!("revoked {user}");
            Ok(())
        }
        Cmd::Device { cmd } => run_device(cmd),
    }
}

/// The MKAUTH PIN is only asked for once the device is enrolled (an unenrolled device has no PIN).
fn management_pin(dev: &mut Device<PcscTransport>) -> Result<Vec<u8>, CliError> {
    if dev.info()?.enrolled {
        read_pin("MKAUTH PIN: ")
    } else {
        Ok(Vec::new())
    }
}

fn print_name(n: &multikey_proto::DeviceName) {
    println!(
        "device name     : {}{}",
        n.name,
        if n.custom { " (custom)" } else { " (default)" }
    );
    if n.reenumeration_pending {
        println!("note            : the host still sees the old name; unplug and replug the key, or run `multikey device reenumerate`");
    }
}

fn run_device(cmd: DeviceCmd) -> Res {
    match cmd {
        DeviceCmd::Show { common } => {
            let n = open(&common)?.device_name()?;
            print_name(&n);
            println!("pending         : {}", n.reenumeration_pending);
            println!("rename enabled  : {}", n.rename_supported);
            Ok(())
        }
        DeviceCmd::Rename {
            name,
            common,
            reenumerate,
        } => {
            // Reject bad names before the device is touched or a PIN is asked for.
            multikey_proto::validate_device_name(&name).map_err(msg)?;
            let mut dev = open(&common)?;
            let pin = management_pin(&mut dev)?;
            eprintln!("Press the device button to confirm the new name...");
            let mut n = dev.set_device_name(&pin, &name, reenumerate)?;
            n.reenumeration_pending &= !reenumerate;
            print_name(&n);
            if reenumerate {
                println!("the device detaches from USB for about a second; the new name is used afterwards");
            }
            Ok(())
        }
        DeviceCmd::ResetName {
            common,
            reenumerate,
        } => {
            let mut dev = open(&common)?;
            let pin = management_pin(&mut dev)?;
            eprintln!("Press the device button to restore the default name...");
            let mut n = dev.clear_device_name(&pin, reenumerate)?;
            n.reenumeration_pending &= !reenumerate;
            print_name(&n);
            if reenumerate {
                println!("the device detaches from USB for about a second; the default name is used afterwards");
            }
            Ok(())
        }
        DeviceCmd::Reenumerate { common } => {
            let mut dev = open(&common)?;
            let pin = management_pin(&mut dev)?;
            eprintln!("Press the device button to confirm...");
            dev.reenumerate(&pin)?;
            println!("the device detaches from USB for about a second");
            Ok(())
        }
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(CliError::Msg(m)) => {
            eprintln!("error: {m}");
            ExitCode::from(EXIT_FAILURE)
        }
        Err(CliError::Host(e)) => {
            eprintln!("error: {e}");
            ExitCode::from(match e {
                Error::NoDevice | Error::NoService(_) => EXIT_NO_DEVICE,
                Error::NoUserPresence => EXIT_NO_PRESENCE,
                _ => EXIT_FAILURE,
            })
        }
    }
}
