//! Trust store: TOML file of trusted (user, public key, device id) entries.
//!
//! ```toml
//! [[key]]
//! user = "alice"
//! pubkey_hex = "04…(130 hex chars)"
//! device_id_hex = "…(32 hex chars)"
//! ```

use multikey_proto::{DEVICE_ID_LEN, PUBKEY_LEN};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TrustError {
    #[error("I/O error on {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("cannot parse trust store: {0}")]
    Parse(String),
    #[error("invalid entry for user {user:?}: {reason}")]
    Invalid { user: String, reason: &'static str },
    #[error("duplicate user {0:?}")]
    Duplicate(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyEntry {
    pub user: String,
    pub pubkey_hex: String,
    pub device_id_hex: String,
}

impl KeyEntry {
    pub fn new(user: &str, pubkey: &[u8; PUBKEY_LEN], device_id: &[u8; DEVICE_ID_LEN]) -> Self {
        Self {
            user: user.to_owned(),
            pubkey_hex: hex::encode(pubkey),
            device_id_hex: hex::encode(device_id),
        }
    }

    fn invalid(&self, reason: &'static str) -> TrustError {
        TrustError::Invalid {
            user: self.user.clone(),
            reason,
        }
    }

    pub fn validate(&self) -> Result<(), TrustError> {
        self.decode().map(|_| ())
    }

    /// Decode to raw bytes, enforcing strict formatting.
    pub fn decode(&self) -> Result<([u8; PUBKEY_LEN], [u8; DEVICE_ID_LEN]), TrustError> {
        if self.user.is_empty() || self.user.chars().any(char::is_control) {
            return Err(self.invalid("user must be non-empty without control characters"));
        }
        if self.pubkey_hex.len() != PUBKEY_LEN * 2 {
            return Err(self.invalid("pubkey_hex must be 130 hex characters"));
        }
        if self.device_id_hex.len() != DEVICE_ID_LEN * 2 {
            return Err(self.invalid("device_id_hex must be 32 hex characters"));
        }
        let pk: [u8; PUBKEY_LEN] = hex::decode(&self.pubkey_hex)
            .map_err(|_| self.invalid("pubkey_hex is not valid hex"))?
            .try_into()
            .map_err(|_| self.invalid("pubkey_hex length"))?;
        if pk[0] != 0x04 {
            return Err(self.invalid("pubkey must be an uncompressed point (0x04 prefix)"));
        }
        let id: [u8; DEVICE_ID_LEN] = hex::decode(&self.device_id_hex)
            .map_err(|_| self.invalid("device_id_hex is not valid hex"))?
            .try_into()
            .map_err(|_| self.invalid("device_id_hex length"))?;
        Ok((pk, id))
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustStore {
    #[serde(default, rename = "key")]
    keys: Vec<KeyEntry>,
}

/// `/etc/multikey/trusted.toml` on Unix, `%ProgramData%\MultiKeys\trusted.toml` on Windows.
///
/// Windows fallback: tools up to 0.1.0 used `%ProgramData%\MultiKey\trusted.toml`. When only that legacy file
/// exists it keeps being used (read and written), so an existing enrollment is never lost or split across two
/// files. Nothing is moved automatically: the folder's permissions protect the store and a move could change them.
pub fn default_trust_store_path() -> PathBuf {
    #[cfg(windows)]
    {
        let base = PathBuf::from(
            std::env::var_os("ProgramData").unwrap_or_else(|| r"C:\ProgramData".into()),
        );
        let current = base.join("MultiKeys").join("trusted.toml");
        let legacy = base.join("MultiKey").join("trusted.toml");
        choose_store_path(
            current.clone(),
            legacy.clone(),
            current.exists(),
            legacy.exists(),
        )
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/etc/multikey/trusted.toml")
    }
}

/// The current path, unless only the legacy file exists.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn choose_store_path(
    current: PathBuf,
    legacy: PathBuf,
    current_exists: bool,
    legacy_exists: bool,
) -> PathBuf {
    if legacy_exists && !current_exists {
        legacy
    } else {
        current
    }
}

impl TrustStore {
    pub fn parse(text: &str) -> Result<Self, TrustError> {
        let store: Self = toml::from_str(text).map_err(|e| TrustError::Parse(e.to_string()))?;
        store.validate()?;
        Ok(store)
    }

    fn validate(&self) -> Result<(), TrustError> {
        for (i, k) in self.keys.iter().enumerate() {
            k.validate()?;
            if self.keys[..i].iter().any(|o| o.user == k.user) {
                return Err(TrustError::Duplicate(k.user.clone()));
            }
        }
        Ok(())
    }

    pub fn load(path: &Path) -> Result<Self, TrustError> {
        let text = std::fs::read_to_string(path).map_err(|source| TrustError::Io {
            path: path.to_owned(),
            source,
        })?;
        Self::parse(&text)
    }

    /// Like [`load`](Self::load) but a missing file yields an empty store.
    pub fn load_or_default(path: &Path) -> Result<Self, TrustError> {
        match Self::load(path) {
            Err(TrustError::Io { source, .. }) if source.kind() == std::io::ErrorKind::NotFound => {
                Ok(Self::default())
            }
            other => other,
        }
    }

    /// Validate and write atomically (temp file + rename), creating parent directories.
    pub fn save(&self, path: &Path) -> Result<(), TrustError> {
        self.validate()?;
        let io = |source| TrustError::Io {
            path: path.to_owned(),
            source,
        };
        let text = toml::to_string_pretty(self).map_err(|e| TrustError::Parse(e.to_string()))?;
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir).map_err(io)?;
        }
        let mut tmp = path.as_os_str().to_owned();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        std::fs::write(&tmp, text).map_err(io)?;
        std::fs::rename(&tmp, path).map_err(io)
    }

    pub fn find(&self, user: &str) -> Option<&KeyEntry> {
        self.keys.iter().find(|k| k.user == user)
    }

    pub fn entries(&self) -> &[KeyEntry] {
        &self.keys
    }

    /// Add an entry; rejects invalid entries and duplicate users.
    pub fn add(&mut self, entry: KeyEntry) -> Result<(), TrustError> {
        entry.validate()?;
        if self.find(&entry.user).is_some() {
            return Err(TrustError::Duplicate(entry.user));
        }
        self.keys.push(entry);
        Ok(())
    }

    /// Remove the entry for `user`; returns whether one existed.
    pub fn remove(&mut self, user: &str) -> bool {
        let n = self.keys.len();
        self.keys.retain(|k| k.user != user);
        self.keys.len() != n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(user: &str) -> KeyEntry {
        let mut pk = [7u8; PUBKEY_LEN];
        pk[0] = 4;
        KeyEntry::new(user, &pk, &[9u8; DEVICE_ID_LEN])
    }

    #[test]
    fn legacy_store_used_only_when_it_alone_exists() {
        let cur = || PathBuf::from("MultiKeys/trusted.toml");
        let old = || PathBuf::from("MultiKey/trusted.toml");
        assert_eq!(
            choose_store_path(cur(), old(), false, false),
            cur(),
            "fresh install"
        );
        assert_eq!(choose_store_path(cur(), old(), true, false), cur());
        assert_eq!(
            choose_store_path(cur(), old(), false, true),
            old(),
            "existing 0.1.0 enrollment keeps working"
        );
        assert_eq!(
            choose_store_path(cur(), old(), true, true),
            cur(),
            "new location wins when both exist"
        );
    }

    #[test]
    fn save_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join("trusted.toml");
        let mut s = TrustStore::default();
        s.add(entry("alice")).unwrap();
        s.add(entry("bob")).unwrap();
        s.save(&path).unwrap();
        let l = TrustStore::load(&path).unwrap();
        assert_eq!(l, s);
        assert_eq!(l.find("bob"), Some(&entry("bob")));
        assert!(l.find("carol").is_none());
    }

    #[test]
    fn missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("none.toml");
        assert!(matches!(TrustStore::load(&p), Err(TrustError::Io { .. })));
        assert!(TrustStore::load_or_default(&p)
            .unwrap()
            .entries()
            .is_empty());
    }

    #[test]
    fn parse_documented_format() {
        let text = format!(
            "[[key]]\nuser = \"alice\"\npubkey_hex = \"04{}\"\ndevice_id_hex = \"{}\"\n",
            "ab".repeat(64),
            "cd".repeat(16)
        );
        let s = TrustStore::parse(&text).unwrap();
        let (pk, id) = s.find("alice").unwrap().decode().unwrap();
        assert_eq!(pk[0], 4);
        assert_eq!(id, [0xcd; 16]);
        assert!(TrustStore::parse("").unwrap().entries().is_empty());
    }

    #[test]
    fn validation() {
        let mut e = entry("alice");
        e.pubkey_hex.pop();
        assert!(e.validate().is_err());
        let mut e = entry("alice");
        e.pubkey_hex.replace_range(0..2, "02");
        assert!(e.validate().is_err());
        let mut e = entry("alice");
        e.pubkey_hex.replace_range(10..12, "zz");
        assert!(e.validate().is_err());
        let mut e = entry("alice");
        e.device_id_hex.push('0');
        assert!(e.validate().is_err());
        let mut e = entry("alice");
        e.device_id_hex.replace_range(0..2, "xx");
        assert!(e.validate().is_err());
        assert!(entry("").validate().is_err());
        assert!(entry("a\nb").validate().is_err());
        assert!(entry("alice").validate().is_ok());
    }

    #[test]
    fn duplicates_and_unknown_fields_rejected() {
        let mut s = TrustStore::default();
        s.add(entry("alice")).unwrap();
        assert!(matches!(
            s.add(entry("alice")),
            Err(TrustError::Duplicate(_))
        ));
        let one = toml::to_string_pretty(&s).unwrap();
        let two = format!("{one}\n{one}");
        assert!(matches!(
            TrustStore::parse(&two),
            Err(TrustError::Duplicate(_))
        ));
        let extra = format!("{one}\nextra = 1\n");
        assert!(TrustStore::parse(&extra).is_err());
        assert!(TrustStore::parse("[[key]]\nuser = \"x\"\n").is_err());
    }

    #[test]
    fn remove_entry() {
        let mut s = TrustStore::default();
        s.add(entry("alice")).unwrap();
        assert!(s.remove("alice"));
        assert!(!s.remove("alice"));
    }
}
