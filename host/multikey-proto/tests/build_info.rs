//! INS 07 BUILD_INFO wire format (docs/PROTOCOLS.md). The response is built by hand from the spec, byte by byte, not
//! with the parser's own tag constants.
use multikey_proto::*;

fn entry(tag: u8, value: &[u8]) -> Vec<u8> {
    let mut v = vec![tag, value.len() as u8];
    v.extend_from_slice(value);
    v
}

const IMAGE: [u8; 32] = [0xAB; 32];
const ELF: [u8; 32] = [0xCD; 32];

fn full_response() -> Vec<u8> {
    let mut r = vec![0x01];
    r.extend(entry(0x01, b"multikey-fido"));
    r.extend(entry(0x02, b"0.3.0"));
    r.extend(entry(0x03, b"v5.5.6"));
    r.extend(entry(0x04, b"281fae077113+dirty"));
    r.extend(entry(0x05, &IMAGE));
    r.extend(entry(0x06, &ELF));
    r.extend(entry(0x07, b"16MB"));
    r.extend(entry(0x08, &[0x01, 0x00, 0x00, 0x00])); // 16 MiB
    r.extend(entry(0x09, &[0x02])); // secure boot on, flash encryption off
    r.extend(entry(0x0A, &[0x09, 0x00, 0x00, 0x02])); // ESP32-S3, revision 0.00, 2 cores
    r.extend(entry(0x0B, &[0x01])); // power-on
    r.extend(entry(0x0C, &[0x00, 0x00, 0x01, 0x2C])); // 300 s
    let mut part = vec![0x00, 0x02, 0x00, 0x00];
    part.extend_from_slice(b"factory");
    r.extend(entry(0x0D, &part));
    r
}

#[test]
fn apdu_is_a_plain_read() {
    assert_eq!(build_info_apdu(), [0x80, 0x07, 0x00, 0x00, 0x00]);
}

#[test]
fn parses_every_field() {
    let info = parse_build_info(&full_response()).unwrap();
    assert_eq!(info.project.as_deref(), Some("multikey-fido"));
    assert_eq!(info.version.as_deref(), Some("0.3.0"));
    assert_eq!(info.idf_version.as_deref(), Some("v5.5.6"));
    assert_eq!(info.commit.as_deref(), Some("281fae077113+dirty"));
    assert_eq!(info.image_sha256, Some(IMAGE));
    assert_eq!(info.elf_sha256, Some(ELF));
    assert_eq!(info.flash_built_for.as_deref(), Some("16MB"));
    assert_eq!(info.flash_chip_bytes, Some(16 * 1024 * 1024));
    assert_eq!(info.flash_encryption, Some(false));
    assert_eq!(info.secure_boot, Some(true));
    assert_eq!(info.chip_model, Some(9));
    assert_eq!(info.chip_revision, Some(0));
    assert_eq!(info.chip_cores, Some(2));
    assert_eq!(info.reset_reason, Some(1));
    assert_eq!(info.uptime_seconds, Some(300));
    assert_eq!(info.partition_offset, Some(0x20000));
    assert_eq!(info.partition_label.as_deref(), Some("factory"));
    assert_eq!(chip_model_name(9), Some("ESP32-S3"));
    assert_eq!(reset_reason_name(1), Some("power-on"));
}

#[test]
fn a_subset_and_unknown_tags_are_fine() {
    // A newer firmware may add tags; an older one may send fewer.
    let mut r = vec![0x01];
    r.extend(entry(0x02, b"0.4.0"));
    r.extend(entry(0x7E, b"from the future"));
    r.extend(entry(0x04, b"unknown"));
    let info = parse_build_info(&r).unwrap();
    assert_eq!(info.version.as_deref(), Some("0.4.0"));
    assert_eq!(info.commit.as_deref(), Some("unknown"));
    assert_eq!(info.image_sha256, None);
    assert_eq!(info.project, None);
}

#[test]
fn rejects_a_malformed_response() {
    assert!(matches!(
        parse_build_info(&[]),
        Err(ProtoError::BadLength { .. })
    ));
    assert_eq!(parse_build_info(&[0x02]), Err(ProtoError::BadVersion(0x02)));

    // An entry that claims more bytes than are left.
    let mut truncated = full_response();
    truncated.truncate(truncated.len() - 3);
    assert!(parse_build_info(&truncated).is_err());
    // A lone tag byte with no length.
    assert!(parse_build_info(&[0x01, 0x02]).is_err());
    // The same tag twice.
    let mut twice = vec![0x01];
    twice.extend(entry(0x02, b"1"));
    twice.extend(entry(0x02, b"2"));
    assert!(parse_build_info(&twice).is_err());
    // A SHA-256 of the wrong size, a u32 of the wrong size.
    let mut r = vec![0x01];
    r.extend(entry(0x05, &[0u8; 31]));
    assert!(parse_build_info(&r).is_err());
    let mut r = vec![0x01];
    r.extend(entry(0x08, &[0u8; 3]));
    assert!(parse_build_info(&r).is_err());
}

#[test]
fn text_must_be_printable_ascii() {
    for bad in [&b"0.3.0\x1b[2J"[..], &b"v\xC3\xA9"[..], &b"tab\there"[..]] {
        let mut r = vec![0x01];
        r.extend(entry(0x02, bad));
        assert!(parse_build_info(&r).is_err(), "{bad:?}");
    }
}

#[test]
fn unknown_codes_have_no_name() {
    assert_eq!(chip_model_name(0xEE), None);
    assert_eq!(reset_reason_name(0xEE), None);
}
