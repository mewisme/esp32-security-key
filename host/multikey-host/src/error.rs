use multikey_proto::{ProtoError, VerifyError};
use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("no matching smart-card reader / device found")]
    NoDevice,
    #[error("several devices match; choose one with --device N, --reader or --hid-path:\n{}", .0.join("\n"))]
    Ambiguous(Vec<String>),
    #[error("PC/SC service unavailable: {0}")]
    NoService(String),
    #[error("device was removed or reset during the operation")]
    DeviceRemoved,
    #[error("PC/SC error: {0}")]
    Pcsc(String),
    #[error("protocol error: {0}")]
    Proto(#[from] ProtoError),
    #[error("MKAUTH applet not present or unexpected SELECT response")]
    BadSelect,
    #[error("no button press within the device timeout (user presence)")]
    NoUserPresence,
    #[error("device is not enrolled")]
    NotEnrolled,
    #[error("device is already enrolled")]
    AlreadyEnrolled,
    #[error("wrong PIN, {0} tries remaining")]
    PinRetries(u8),
    #[error("PIN is blocked; a FIDO factory reset is required")]
    PinBlocked,
    #[error("device returned status word {0:#06x}")]
    Status(u16),
    #[error("device identity does not match the trusted entry")]
    DeviceMismatch,
    #[error("signature verification failed: {0}")]
    Verify(#[from] VerifyError),
    #[error("operation exceeded the {0:?} timeout")]
    Timeout(std::time::Duration),
    #[error("random number generation failed")]
    Random,
    #[error("this firmware does not implement device naming (INS 06); update the firmware")]
    NameUnsupported,
    #[error(
        "renaming is disabled in this firmware build (CONFIG_MULTIKEY_USB_CUSTOM_NAME_ENABLED=n)"
    )]
    RenameDisabled,
    #[error("the device rejected the name or the PIN field (wrong data)")]
    NameRejected,
    #[error("this firmware does not report its build (INS 07); update the firmware")]
    BuildInfoUnsupported,
}
