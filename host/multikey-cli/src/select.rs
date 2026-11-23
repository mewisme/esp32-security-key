//! Device selection for the new command groups (`device`, `fido`, `mkauth`).
//!
//! The new commands never guess: more than one candidate is an error that lists them (exit 2). The legacy
//! top-level commands keep their old first-match behavior and do not go through here.

use multikey_host::{inventory, resolve, DeviceEntry, Error, Inventory, Selector};

use crate::error::CliError;

#[derive(Debug, Clone, Default)]
pub struct SelectArgs {
    pub device: Option<usize>,
    pub reader: Option<String>,
    pub hid_path: Option<String>,
}

/// Which transport a command needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Need {
    Any,
    Reader,
    Hid,
}

impl SelectArgs {
    pub fn selector(&self) -> Result<Selector, CliError> {
        let given = [
            self.device.is_some(),
            self.reader.is_some(),
            self.hid_path.is_some(),
        ];
        if given.iter().filter(|g| **g).count() > 1 {
            return Err(CliError::Usage(
                "use only one of --device, --reader, --hid-path".into(),
            ));
        }
        Ok(if let Some(i) = self.device {
            Selector::Index(i)
        } else if let Some(r) = &self.reader {
            Selector::Reader(r.clone())
        } else if let Some(p) = &self.hid_path {
            Selector::HidPath(p.clone())
        } else {
            Selector::Auto
        })
    }
}

fn satisfies(e: &DeviceEntry, need: Need) -> bool {
    match need {
        Need::Any => true,
        Need::Reader => e.reader.is_some(),
        Need::Hid => e.hid.is_some(),
    }
}

/// Pick exactly one device from an inventory for a command that needs `need`.
pub fn pick(inv: &Inventory, args: &SelectArgs, need: Need) -> Result<DeviceEntry, CliError> {
    let sel = args.selector()?;
    if let Selector::Index(i) = sel {
        let e = inv
            .entries
            .iter()
            .find(|e| e.index == i)
            .ok_or(Error::NoDevice)?;
        if !satisfies(e, need) {
            return Err(CliError::Usage(format!(
                "device {i} has no {} interface; see `multikey device list`",
                if need == Need::Reader {
                    "smart-card (CCID/PC-SC)"
                } else {
                    "FIDO HID"
                }
            )));
        }
        return Ok(e.clone());
    }
    let candidates: Vec<DeviceEntry> = inv
        .entries
        .iter()
        .filter(|e| satisfies(e, need))
        .cloned()
        .collect();
    if candidates.is_empty() {
        if need != Need::Hid {
            if let Some(why) = &inv.pcsc_error {
                return Err(Error::NoService(why.clone()).into());
            }
        }
        return Err(Error::NoDevice.into());
    }
    Ok(resolve(&candidates, &sel)?)
}

pub fn pick_live(args: &SelectArgs, need: Need) -> Result<DeviceEntry, CliError> {
    pick(&inventory(), args, need)
}

#[cfg(test)]
mod tests {
    use super::*;
    use multikey_fido::HidDevice;
    use multikey_host::pair;

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

    fn inv(entries: Vec<DeviceEntry>) -> Inventory {
        Inventory {
            entries,
            pcsc_error: None,
        }
    }

    #[test]
    fn auto_single_candidate() {
        let i = inv(pair(
            vec![hid("p1", "A Key")],
            vec!["MultiKeys A Key CCID 0".into()],
        ));
        assert!(pick(&i, &SelectArgs::default(), Need::Reader).is_ok());
    }

    #[test]
    fn unpaired_hid_and_reader_are_one_candidate_per_need() {
        let i = inv(pair(
            vec![hid("p1", "A Key")],
            vec!["MultiKeys Other CCID 0".into()],
        ));
        assert_eq!(i.entries.len(), 2);
        assert!(pick(&i, &SelectArgs::default(), Need::Hid).is_ok());
        assert!(pick(&i, &SelectArgs::default(), Need::Reader).is_ok());
        // `Any` sees both entries and refuses to guess.
        assert!(matches!(
            pick(&i, &SelectArgs::default(), Need::Any),
            Err(CliError::Host(Error::Ambiguous(_)))
        ));
    }

    #[test]
    fn two_keys_are_ambiguous() {
        let i = inv(pair(vec![hid("p1", "A Key"), hid("p2", "B Key")], vec![]));
        assert!(matches!(
            pick(&i, &SelectArgs::default(), Need::Hid),
            Err(CliError::Host(Error::Ambiguous(_)))
        ));
        let a = SelectArgs {
            device: Some(1),
            ..Default::default()
        };
        assert_eq!(pick(&i, &a, Need::Hid).unwrap().hid.unwrap().path, "p2");
    }

    #[test]
    fn index_without_needed_transport_is_usage_error() {
        let i = inv(pair(vec![hid("p1", "A Key")], vec![]));
        let a = SelectArgs {
            device: Some(0),
            ..Default::default()
        };
        assert!(matches!(
            pick(&i, &a, Need::Reader),
            Err(CliError::Usage(_))
        ));
    }

    #[test]
    fn conflicting_selectors_rejected() {
        let a = SelectArgs {
            device: Some(0),
            reader: Some("x".into()),
            hid_path: None,
        };
        assert!(matches!(a.selector(), Err(CliError::Usage(_))));
    }

    #[test]
    fn pcsc_outage_reported_when_a_reader_is_needed() {
        let i = Inventory {
            entries: vec![],
            pcsc_error: Some("PC/SC service unavailable".into()),
        };
        assert!(matches!(
            pick(&i, &SelectArgs::default(), Need::Reader),
            Err(CliError::Host(Error::NoService(_)))
        ));
        assert!(matches!(
            pick(&i, &SelectArgs::default(), Need::Hid),
            Err(CliError::Host(Error::NoDevice))
        ));
    }
}
