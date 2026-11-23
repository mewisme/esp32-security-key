//! `multikey device build`: what firmware is running on the key (MKAUTH INS 07), optionally matched against a
//! release's `firmware-manifest.json`.
//!
//! The firmware reports the SHA-256 of its app image as flashed. A release manifest lists the same hash per build
//! (`images[role=app].sha256`), so a match proves the key runs exactly that published image. No match means a local,
//! modified or unpublished build (or a manifest of another release): it is not proof of tampering.

use std::path::PathBuf;

use multikey_proto::{chip_model_name, reset_reason_name, BuildInfo};
use serde::Serialize;
use serde_json::Value;

use crate::cmd_mkauth::Opener;
use crate::console::Console;
use crate::error::{msg, CliError, Res};
use crate::output::emit;

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct BuildReport {
    pub project: Option<String>,
    pub version: Option<String>,
    pub idf_version: Option<String>,
    /// 12 hex digits, `+dirty` when tracked files were modified at build time, or `unknown`.
    pub commit: Option<String>,
    pub image_sha256: Option<String>,
    pub elf_sha256: Option<String>,
    pub flash_built_for: Option<String>,
    pub flash_chip_bytes: Option<u32>,
    pub flash_encryption: Option<bool>,
    pub secure_boot: Option<bool>,
    pub chip: Option<String>,
    pub chip_revision: Option<String>,
    pub chip_cores: Option<u8>,
    pub reset_reason: Option<String>,
    pub uptime_seconds: Option<u32>,
    pub partition_offset: Option<u32>,
    pub partition_label: Option<String>,
}

impl From<&BuildInfo> for BuildReport {
    fn from(b: &BuildInfo) -> Self {
        Self {
            project: b.project.clone(),
            version: b.version.clone(),
            idf_version: b.idf_version.clone(),
            commit: b.commit.clone(),
            image_sha256: b.image_sha256.map(hex::encode),
            elf_sha256: b.elf_sha256.map(hex::encode),
            flash_built_for: b.flash_built_for.clone(),
            flash_chip_bytes: b.flash_chip_bytes,
            flash_encryption: b.flash_encryption,
            secure_boot: b.secure_boot,
            chip: b.chip_model.map(|m| {
                chip_model_name(m).map_or_else(|| format!("chip model {m}"), str::to_owned)
            }),
            chip_revision: b
                .chip_revision
                .map(|r| format!("{}.{:02}", r / 100, r % 100)),
            chip_cores: b.chip_cores,
            reset_reason: b.reset_reason.map(|r| {
                reset_reason_name(r).map_or_else(|| format!("reset reason {r}"), str::to_owned)
            }),
            uptime_seconds: b.uptime_seconds,
            partition_offset: b.partition_offset,
            partition_label: b.partition_label.clone(),
        }
    }
}

/// One build of a release manifest whose app image is the one running on the key.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct MatchedBuild {
    pub tag: Option<String>,
    pub version: Option<String>,
    pub build_id: String,
    pub profile_id: Option<String>,
    pub flash_size: Option<String>,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct ManifestCheck {
    pub manifest: String,
    pub matches: Vec<MatchedBuild>,
}

/// Builds of `manifest_json` whose `images[role=app].sha256` equals the running image's SHA-256.
pub fn match_manifest(
    info: &BuildInfo,
    manifest_json: &str,
    label: &str,
) -> Result<ManifestCheck, String> {
    let Some(image) = info.image_sha256 else {
        return Err("the firmware did not report an image SHA-256, so it cannot be matched".into());
    };
    let want = hex::encode(image);
    let v: Value = serde_json::from_str(manifest_json)
        .map_err(|e| format!("{label} is not valid JSON: {e}"))?;
    if v["schema"] != "multikeys-firmware-manifest" {
        return Err(format!("{label} is not a MultiKeys firmware manifest"));
    }
    let text = |x: &Value| x.as_str().map(str::to_owned);
    let builds = v["builds"]
        .as_array()
        .ok_or_else(|| format!("{label} has no builds list"))?;
    let matches = builds
        .iter()
        .filter(|b| {
            b["images"].as_array().is_some_and(|imgs| {
                imgs.iter()
                    .any(|i| i["role"] == "app" && i["sha256"].as_str() == Some(want.as_str()))
            })
        })
        .map(|b| MatchedBuild {
            tag: text(&v["tag"]),
            version: text(&v["version"]),
            build_id: text(&b["id"]).unwrap_or_default(),
            profile_id: text(&b["profile_id"]),
            flash_size: text(&b["flash_size"]),
        })
        .collect();
    Ok(ManifestCheck {
        manifest: label.to_owned(),
        matches,
    })
}

#[derive(Serialize)]
pub struct BuildOutput {
    pub build: BuildReport,
    pub manifest_check: Option<ManifestCheck>,
}

fn duration(s: u32) -> String {
    match (s / 3600, s / 60 % 60, s % 60) {
        (0, 0, s) => format!("{s} s"),
        (0, m, s) => format!("{m} min {s} s"),
        (h, m, _) => format!("{h} h {m} min"),
    }
}

/// The human-readable lines for a build (shared by `device build` and `device info`).
pub fn write_report(w: &mut dyn std::io::Write, b: &BuildReport) -> std::io::Result<()> {
    let dash = || "-".to_owned();
    writeln!(
        w,
        "firmware         : {} {} (ESP-IDF {})",
        b.project.clone().unwrap_or_else(dash),
        b.version.clone().unwrap_or_else(dash),
        b.idf_version.clone().unwrap_or_else(dash)
    )?;
    writeln!(
        w,
        "source commit    : {}",
        b.commit.clone().unwrap_or_else(dash)
    )?;
    writeln!(
        w,
        "image sha-256    : {}",
        b.image_sha256.clone().unwrap_or_else(dash)
    )?;
    let chip_flash = b
        .flash_chip_bytes
        .map_or_else(dash, |n| format!("{} MB", n / (1024 * 1024)));
    writeln!(
        w,
        "flash            : built for {}, chip reports {chip_flash}",
        b.flash_built_for.clone().unwrap_or_else(dash)
    )?;
    writeln!(
        w,
        "chip             : {} revision {}, {} core(s)",
        b.chip.clone().unwrap_or_else(dash),
        b.chip_revision.clone().unwrap_or_else(dash),
        b.chip_cores.map_or_else(dash, |n| n.to_string())
    )?;
    let on = |v: Option<bool>| match v {
        Some(true) => "on",
        Some(false) => "off",
        None => "-",
    };
    writeln!(
        w,
        "security         : flash encryption {}, secure boot {}",
        on(b.flash_encryption),
        on(b.secure_boot)
    )?;
    writeln!(
        w,
        "this boot        : {}, up {}",
        b.reset_reason.clone().unwrap_or_else(dash),
        b.uptime_seconds.map_or_else(dash, duration)
    )?;
    if let (Some(off), Some(label)) = (b.partition_offset, &b.partition_label) {
        writeln!(w, "running from     : {label} at {off:#x}")?;
    }
    Ok(())
}

pub fn build(op: &Opener, c: &mut dyn Console, json: bool, manifest: Option<PathBuf>) -> Res {
    let info = op.open()?.build_info()?;
    let manifest_check = match &manifest {
        None => None,
        Some(path) => {
            let label = path.display().to_string();
            let text = std::fs::read_to_string(path)
                .map_err(|e| CliError::Usage(format!("cannot read {label}: {e}")))?;
            Some(match_manifest(&info, &text, &label).map_err(CliError::Usage)?)
        }
    };
    let out = BuildOutput {
        build: BuildReport::from(&info),
        manifest_check,
    };
    emit(c.out(), json, &out, |w| {
        write_report(w, &out.build)?;
        if let Some(chk) = &out.manifest_check {
            if chk.matches.is_empty() {
                writeln!(
                    w,
                    "published        : NOT in {}: a local, modified or other release's image",
                    chk.manifest
                )?;
            }
            for m in &chk.matches {
                writeln!(
                    w,
                    "published        : IS the app image of {} {} ({}, {})",
                    m.tag.clone().unwrap_or_else(|| "?".into()),
                    m.version.clone().unwrap_or_default(),
                    m.build_id,
                    m.flash_size.clone().unwrap_or_default()
                )?;
            }
        }
        Ok(())
    })
    .and_then(|()| {
        if out.manifest_check.is_none() && !json {
            writeln!(
                c.err(),
                "tip: `gh release download vX.Y.Z -p firmware-manifest.json`, then `multikey device build --manifest firmware-manifest.json` checks this image against a release."
            )
            .map_err(msg)?;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(sha: Option<[u8; 32]>) -> BuildInfo {
        BuildInfo {
            version: Some("0.3.0".into()),
            image_sha256: sha,
            chip_model: Some(9),
            chip_revision: Some(101),
            reset_reason: Some(1),
            ..Default::default()
        }
    }

    fn manifest(app_sha: &str) -> String {
        serde_json::json!({
            "schema": "multikeys-firmware-manifest",
            "tag": "v0.3.0",
            "version": "0.3.0",
            "builds": [
                {"id": "esp32s3-4mb-fido-dev", "profile_id": "esp32s3-4mb", "flash_size": "4MB",
                 "images": [{"role": "app", "sha256": "11".repeat(32)}]},
                {"id": "esp32s3-16mb-fido-dev", "profile_id": "esp32s3-16mb", "flash_size": "16MB",
                 "images": [{"role": "bootloader", "sha256": app_sha}, {"role": "app", "sha256": app_sha}]},
            ]
        })
        .to_string()
    }

    #[test]
    fn matches_only_the_app_image_of_the_right_build() {
        let sha = [0xAB; 32];
        let chk = match_manifest(&info(Some(sha)), &manifest(&hex::encode(sha)), "m.json").unwrap();
        assert_eq!(chk.matches.len(), 1);
        assert_eq!(chk.matches[0].build_id, "esp32s3-16mb-fido-dev");
        assert_eq!(chk.matches[0].tag.as_deref(), Some("v0.3.0"));
    }

    #[test]
    fn a_hash_in_no_build_matches_nothing() {
        let chk = match_manifest(
            &info(Some([0x01; 32])),
            &manifest(&"cd".repeat(32)),
            "m.json",
        )
        .unwrap();
        assert!(chk.matches.is_empty());
    }

    #[test]
    fn a_bootloader_hash_is_not_an_app_match() {
        // The same value under role "bootloader" must not count.
        let m = serde_json::json!({
            "schema": "multikeys-firmware-manifest", "builds": [
                {"id": "x", "images": [{"role": "bootloader", "sha256": "ab".repeat(32)}]}]
        })
        .to_string();
        let chk = match_manifest(&info(Some([0xAB; 32])), &m, "m.json").unwrap();
        assert!(chk.matches.is_empty());
    }

    #[test]
    fn refuses_what_is_not_a_manifest_or_has_nothing_to_match() {
        assert!(match_manifest(&info(None), &manifest("00"), "m").is_err());
        assert!(match_manifest(&info(Some([0; 32])), "not json", "m").is_err());
        assert!(match_manifest(
            &info(Some([0; 32])),
            r#"{"schema":"other","builds":[]}"#,
            "m"
        )
        .is_err());
    }

    #[test]
    fn report_names_codes_and_formats_the_revision() {
        let r = BuildReport::from(&info(None));
        assert_eq!(r.chip.as_deref(), Some("ESP32-S3"));
        assert_eq!(r.chip_revision.as_deref(), Some("1.01"));
        assert_eq!(r.reset_reason.as_deref(), Some("power-on"));
        assert_eq!(duration(5), "5 s");
        assert_eq!(duration(185), "3 min 5 s");
        assert_eq!(duration(7500), "2 h 5 min");
    }
}
