use crate::error::{Error, Result};
use std::ffi::CString;

/// Sends a command APDU and returns the full response (data ‖ SW1 SW2).
pub trait Transport {
    fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>>;
}

fn map_pcsc(e: pcsc::Error) -> Error {
    use pcsc::Error as E;
    match e {
        E::RemovedCard | E::NoSmartcard | E::ResetCard | E::UnpoweredCard | E::UnknownCard => {
            Error::DeviceRemoved
        }
        E::NoReadersAvailable | E::UnknownReader | E::ReaderUnavailable => Error::NoDevice,
        E::NoService | E::ServiceStopped => Error::NoService(e.to_string()),
        other => Error::Pcsc(other.to_string()),
    }
}

fn establish() -> Result<pcsc::Context> {
    pcsc::Context::establish(pcsc::Scope::User).map_err(map_pcsc)
}

/// Names of all PC/SC readers (an absent reader list is an empty vector).
pub fn list_readers() -> Result<Vec<String>> {
    let ctx = establish()?;
    match ctx.list_readers_owned() {
        Ok(v) => Ok(v
            .into_iter()
            .map(|c| c.to_string_lossy().into_owned())
            .collect()),
        Err(pcsc::Error::NoReadersAvailable) => Ok(Vec::new()),
        Err(e) => Err(map_pcsc(e)),
    }
}

/// PC/SC card connection (shared mode).
pub struct PcscTransport {
    card: pcsc::Card,
    // Keep the context alive for the lifetime of the card.
    _ctx: pcsc::Context,
}

impl PcscTransport {
    /// Connect to `reader` if given (exact or case-insensitive substring), else to the first
    /// reader whose name contains "MultiKey" or "ESP32".
    pub fn open(reader: Option<&str>) -> Result<Self> {
        let ctx = establish()?;
        let readers = match ctx.list_readers_owned() {
            Ok(r) => r,
            Err(pcsc::Error::NoReadersAvailable) => return Err(Error::NoDevice),
            Err(e) => return Err(map_pcsc(e)),
        };
        let chosen: &CString = readers
            .iter()
            .find(|r| matches_reader(&r.to_string_lossy(), reader))
            .ok_or(Error::NoDevice)?;
        let card = ctx
            .connect(chosen, pcsc::ShareMode::Shared, pcsc::Protocols::ANY)
            .map_err(map_pcsc)?;
        Ok(Self { card, _ctx: ctx })
    }
}

pub(crate) fn matches_reader(name: &str, wanted: Option<&str>) -> bool {
    let n = name.to_lowercase();
    match wanted {
        Some(w) => name == w || n.contains(&w.to_lowercase()),
        None => n.contains("multikey") || n.contains("esp32"),
    }
}

impl Transport for PcscTransport {
    fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        let mut buf = [0u8; pcsc::MAX_BUFFER_SIZE];
        self.card
            .transmit(apdu, &mut buf)
            .map(<[u8]>::to_vec)
            .map_err(map_pcsc)
    }
}

#[cfg(test)]
mod tests {
    use super::matches_reader;

    #[test]
    fn reader_matching() {
        assert!(matches_reader("Espressif MultiKey 0", None));
        assert!(matches_reader("Some ESP32-S3 CCID", None));
        assert!(!matches_reader("Yubico YubiKey", None));
        assert!(matches_reader("Yubico YubiKey", Some("yubikey")));
        assert!(!matches_reader("Espressif MultiKey 0", Some("other")));
    }
}
