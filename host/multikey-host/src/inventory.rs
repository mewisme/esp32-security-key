//! Device inventory: the FIDO HID interfaces and the PC/SC CCID readers that belong to MultiKeys keys, and the
//! rules for choosing one of them.
//!
//! PC/SC exposes no serial number, so a HID interface and a reader are paired only when that is
//! unambiguous: the reader name contains the HID product string, that product string occurs on exactly one HID
//! interface and the reader name occurs once. Anything else stays two separate, unpaired entries; the tool
//! reports the ambiguity and never guesses.

use multikey_fido::HidDevice;
use serde::Serialize;

use crate::error::{Error, Result};
use crate::transport::{list_readers, matches_reader};

/// Espressif's USB vendor id (the development default of this firmware).
const ESPRESSIF_VID: u16 = 0x303A;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DeviceEntry {
    pub index: usize,
    pub hid: Option<HidDevice>,
    pub reader: Option<String>,
    pub paired: bool,
}

impl DeviceEntry {
    /// One line for tables and ambiguity messages.
    pub fn describe(&self) -> String {
        let hid = match &self.hid {
            Some(h) => format!(
                "HID {:04x}:{:04x} \"{}\" {}",
                h.vid, h.pid, h.product, h.path
            ),
            None => "HID -".to_string(),
        };
        let reader = match &self.reader {
            Some(r) => format!("reader \"{r}\""),
            None => "reader -".to_string(),
        };
        format!(
            "[{}] {}; {}{}",
            self.index,
            hid,
            reader,
            if self.paired { " (paired)" } else { "" }
        )
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Inventory {
    pub entries: Vec<DeviceEntry>,
    /// Why the PC/SC half could not be listed (service not running, ...), if it could not.
    pub pcsc_error: Option<String>,
}

fn is_multikey_hid(h: &HidDevice) -> bool {
    h.vid == ESPRESSIF_VID || h.product.to_lowercase().contains("multikey")
}

/// The device name behind an interface string: the firmware names its interfaces "<name> FIDO",
/// "<name> Keyboard" and "<name> CCID", and the reader name is "<manufacturer> <name> CCID <n>".
fn base_name(product: &str) -> String {
    let p = product.trim().to_lowercase();
    for suffix in [" fido", " keyboard"] {
        if let Some(b) = p.strip_suffix(suffix) {
            return b.to_string();
        }
    }
    p
}

/// Pair HID interfaces with readers (see module docs) and number the result: paired entries first, then the
/// remaining HID interfaces by path, then the remaining readers by name.
pub fn pair(mut hid: Vec<HidDevice>, mut readers: Vec<String>) -> Vec<DeviceEntry> {
    hid.sort_by(|a, b| a.path.cmp(&b.path));
    readers.sort();
    let mut entries: Vec<DeviceEntry> = Vec::new();
    let mut used_reader = vec![false; readers.len()];
    let mut unpaired_hid: Vec<HidDevice> = Vec::new();
    for h in hid.iter() {
        let product = base_name(&h.product);
        let unique_product = !product.is_empty()
            && hid
                .iter()
                .filter(|o| base_name(&o.product) == product)
                .count()
                == 1;
        let candidates: Vec<usize> = readers
            .iter()
            .enumerate()
            .filter(|(_, r)| unique_product && r.to_lowercase().contains(&product))
            .map(|(i, _)| i)
            .collect();
        if candidates.len() == 1 && !used_reader[candidates[0]] {
            let i = candidates[0];
            // The reader name must also not look like it belongs to another HID interface.
            let others = hid
                .iter()
                .filter(|o| {
                    let b = base_name(&o.product);
                    o.path != h.path && !b.is_empty() && readers[i].to_lowercase().contains(&b)
                })
                .count();
            if others == 0 {
                used_reader[i] = true;
                entries.push(DeviceEntry {
                    index: 0,
                    hid: Some(h.clone()),
                    reader: Some(readers[i].clone()),
                    paired: true,
                });
                continue;
            }
        }
        unpaired_hid.push(h.clone());
    }
    for h in unpaired_hid {
        entries.push(DeviceEntry {
            index: 0,
            hid: Some(h),
            reader: None,
            paired: false,
        });
    }
    for (i, r) in readers.into_iter().enumerate() {
        if !used_reader[i] {
            entries.push(DeviceEntry {
                index: 0,
                hid: None,
                reader: Some(r),
                paired: false,
            });
        }
    }
    for (i, e) in entries.iter_mut().enumerate() {
        e.index = i;
    }
    entries
}

/// Enumerate the system. PC/SC problems do not hide the HID half (and vice versa).
pub fn inventory() -> Inventory {
    let hid: Vec<HidDevice> = multikey_fido::list_devices()
        .into_iter()
        .filter(is_multikey_hid)
        .collect();
    let (readers, pcsc_error) = match list_readers() {
        Ok(r) => (
            r.into_iter().filter(|n| matches_reader(n, None)).collect(),
            None,
        ),
        Err(e) => (Vec::new(), Some(e.to_string())),
    };
    Inventory {
        entries: pair(hid, readers),
        pcsc_error,
    }
}

/// How the user picked a device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selector {
    Auto,
    Index(usize),
    /// Case-insensitive substring of the PC/SC reader name.
    Reader(String),
    /// Exact HID path.
    HidPath(String),
}

/// Choose one entry. `Auto` demands exactly one candidate; ambiguity is an error listing the candidates.
pub fn resolve(entries: &[DeviceEntry], sel: &Selector) -> Result<DeviceEntry> {
    let hits: Vec<&DeviceEntry> = match sel {
        Selector::Auto => entries.iter().collect(),
        Selector::Index(i) => entries.iter().filter(|e| e.index == *i).collect(),
        Selector::Reader(w) => {
            let w = w.to_lowercase();
            entries
                .iter()
                .filter(|e| {
                    e.reader
                        .as_ref()
                        .is_some_and(|r| r.to_lowercase().contains(&w))
                })
                .collect()
        }
        Selector::HidPath(p) => entries
            .iter()
            .filter(|e| e.hid.as_ref().is_some_and(|h| &h.path == p))
            .collect(),
    };
    match hits.as_slice() {
        [] => Err(Error::NoDevice),
        [one] => Ok((*one).clone()),
        many => Err(Error::Ambiguous(
            many.iter().map(|e| e.describe()).collect(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hid(path: &str, product: &str) -> HidDevice {
        HidDevice {
            index: 0,
            path: path.into(),
            vid: 0x303A,
            pid: 0x4002,
            product: product.into(),
            serial: None,
        }
    }

    #[test]
    fn one_plus_one_pairs() {
        let e = pair(
            vec![hid("p1", "MultiKeys Security Key")],
            vec!["MultiKeys MultiKeys Security Key CCID 0".into()],
        );
        assert_eq!(e.len(), 1);
        assert!(e[0].paired);
        assert_eq!(e[0].index, 0);
    }

    #[test]
    fn firmware_interface_suffix_is_ignored() {
        let e = pair(
            vec![hid("p1", "MultiKeys Security Key FIDO")],
            vec!["MultiKeys MultiKeys Security Key CCID 0".into()],
        );
        assert_eq!(e.len(), 1);
        assert!(e[0].paired);
    }

    #[test]
    fn renamed_product_still_pairs() {
        let e = pair(
            vec![hid("p1", "Alice Key")],
            vec!["MultiKeys Alice Key CCID 0".into()],
        );
        assert_eq!(e.len(), 1);
        assert!(e[0].paired);
    }

    #[test]
    fn two_identical_products_stay_unpaired() {
        let e = pair(
            vec![
                hid("p1", "MultiKeys Security Key"),
                hid("p2", "MultiKeys Security Key"),
            ],
            vec![
                "MultiKeys MultiKeys Security Key CCID 0".into(),
                "MultiKeys MultiKeys Security Key CCID 1".into(),
            ],
        );
        assert_eq!(e.len(), 4);
        assert!(e.iter().all(|x| !x.paired));
        assert_eq!(
            e.iter().map(|x| x.index).collect::<Vec<_>>(),
            vec![0, 1, 2, 3]
        );
    }

    #[test]
    fn no_devices_is_empty() {
        assert!(pair(vec![], vec![]).is_empty());
    }

    #[test]
    fn unmatched_reader_and_hid_stay_separate() {
        let e = pair(
            vec![hid("p1", "Alice Key")],
            vec!["MultiKeys Bob Key CCID 0".into()],
        );
        assert_eq!(e.len(), 2);
        assert!(e.iter().all(|x| !x.paired));
    }

    #[test]
    fn paired_entries_sort_first() {
        let e = pair(
            vec![hid("p1", "Alice Key"), hid("p0", "Orphan")],
            vec!["MultiKeys Alice Key CCID 0".into()],
        );
        assert!(e[0].paired);
        assert!(!e[1].paired);
    }

    #[test]
    fn resolve_rules() {
        let none: Vec<DeviceEntry> = vec![];
        assert!(matches!(
            resolve(&none, &Selector::Auto),
            Err(Error::NoDevice)
        ));
        let one = pair(vec![hid("p1", "A Key")], vec![]);
        assert_eq!(resolve(&one, &Selector::Auto).unwrap().index, 0);
        let two = pair(vec![hid("p1", "A Key"), hid("p2", "B Key")], vec![]);
        match resolve(&two, &Selector::Auto) {
            Err(Error::Ambiguous(lines)) => assert_eq!(lines.len(), 2),
            other => panic!("{other:?}"),
        }
        assert_eq!(
            resolve(&two, &Selector::Index(1))
                .unwrap()
                .hid
                .unwrap()
                .path,
            "p2"
        );
        assert!(matches!(
            resolve(&two, &Selector::Index(5)),
            Err(Error::NoDevice)
        ));
        assert_eq!(
            resolve(&two, &Selector::HidPath("p1".into()))
                .unwrap()
                .index,
            0
        );
    }

    #[test]
    fn resolve_reader_substring() {
        let e = pair(
            vec![],
            vec![
                "MultiKeys Alice CCID 0".into(),
                "MultiKeys Bob CCID 0".into(),
            ],
        );
        assert!(resolve(&e, &Selector::Reader("alice".into()))
            .unwrap()
            .reader
            .unwrap()
            .contains("Alice"));
        assert!(matches!(
            resolve(&e, &Selector::Reader("multikeys".into())),
            Err(Error::Ambiguous(_))
        ));
    }
}
