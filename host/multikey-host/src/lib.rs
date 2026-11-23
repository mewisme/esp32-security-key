//! Host-side library for the MKAUTH v1 applet: PC/SC transport, device operations, trust store.

mod device;
mod error;
#[cfg(feature = "inventory")]
mod inventory;
#[cfg(test)]
mod mock;
mod transport;
mod trust;

pub use device::{Device, TrustedKey};
pub use error::{Error, Result};
#[cfg(feature = "inventory")]
pub use inventory::{inventory, pair, resolve, DeviceEntry, Inventory, Selector};
pub use transport::{list_readers, PcscTransport, Transport};
pub use trust::{default_trust_store_path, KeyEntry, TrustError, TrustStore};
