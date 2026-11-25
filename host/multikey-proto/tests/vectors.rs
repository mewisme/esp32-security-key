//! Deterministic vectors. The private key is TEST ONLY (bytes 0x01..0x20).
use multikey_proto::*;
use serde_json::Value;

struct V {
    host_nonce: [u8; 32],
    device_nonce: [u8; 32],
    device_id: [u8; 16],
    pubkey: [u8; 65],
    sig: Vec<u8>,
    j: Value,
}

fn load() -> V {
    let j: Value = serde_json::from_str(include_str!("vectors.json")).unwrap();
    let h = |k: &str| hex::decode(j[k].as_str().unwrap()).unwrap();
    V {
        host_nonce: h("host_nonce_hex").try_into().unwrap(),
        device_nonce: h("device_nonce_hex").try_into().unwrap(),
        device_id: h("device_id_hex").try_into().unwrap(),
        pubkey: h("pubkey_hex").try_into().unwrap(),
        sig: h("signature_der_hex"),
        j,
    }
}

fn hx(b: &[u8]) -> String {
    hex::encode(b)
}

#[test]
fn valid_signature_verifies_and_is_deterministic() {
    let v = load();
    let t = transcript(&v.host_nonce, &v.device_nonce, &v.device_id);
    assert_eq!(t.len(), 10 + 32 + 32 + 16);
    assert_eq!(&t[..10], b"MKAUTH-v1\0");
    assert_eq!(verify(&v.pubkey, &t, &v.sig), Ok(()));
    // Key and RFC 6979 signature reproduce the pinned vector.
    assert_eq!(testkey::public_key(), v.pubkey);
    assert_eq!(testkey::sign(&t), v.sig);
}

#[test]
fn tampered_inputs_rejected() {
    let v = load();
    let t = |h: &[u8; 32], d: &[u8; 32], i: &[u8; 16]| transcript(h, d, i);
    let mut h = v.host_nonce;
    h[0] ^= 1;
    assert_eq!(
        verify(&v.pubkey, &t(&h, &v.device_nonce, &v.device_id), &v.sig),
        Err(VerifyError::BadSignature)
    );
    let mut d = v.device_nonce;
    d[31] ^= 0x80;
    assert!(verify(&v.pubkey, &t(&v.host_nonce, &d, &v.device_id), &v.sig).is_err());
    let mut i = v.device_id;
    i[15] ^= 1;
    assert!(verify(&v.pubkey, &t(&v.host_nonce, &v.device_nonce, &i), &v.sig).is_err());
}

#[test]
fn tampered_signature_rejected() {
    let v = load();
    let t = transcript(&v.host_nonce, &v.device_nonce, &v.device_id);
    for pos in 0..v.sig.len() {
        let mut s = v.sig.clone();
        s[pos] ^= 0x01;
        assert!(
            verify(&v.pubkey, &t, &s).is_err(),
            "byte {pos} flip accepted"
        );
    }
}

#[test]
fn wrong_pubkey_rejected() {
    let v = load();
    let t = transcript(&v.host_nonce, &v.device_nonce, &v.device_id);
    // A valid but different point: 2*G.
    let other = hex::decode("047cf27b188d034f7e8a52380304b51ac3c08969e277f21b35a60b48fc4766997807775510db8ed040293d9ac69f7430dbba7dade63ce982299e04b79d227873d1").unwrap();
    assert_eq!(
        verify(&other.try_into().unwrap(), &t, &v.sig),
        Err(VerifyError::BadSignature)
    );
}

#[test]
fn invalid_points_and_encodings_rejected() {
    let v = load();
    let t = transcript(&v.host_nonce, &v.device_nonce, &v.device_id);
    let mut off_curve = v.pubkey;
    off_curve[64] ^= 1;
    assert_eq!(
        verify(&off_curve, &t, &v.sig),
        Err(VerifyError::BadPublicKey)
    );
    let mut bad_prefix = v.pubkey;
    bad_prefix[0] = 0x02;
    assert_eq!(
        verify(&bad_prefix, &t, &v.sig),
        Err(VerifyError::BadPublicKey)
    );
    assert_eq!(
        verify(&[0u8; 65], &t, &v.sig),
        Err(VerifyError::BadPublicKey)
    );
    // Oversized / trailing data / truncated.
    let mut long = v.sig.clone();
    long.extend_from_slice(&[0u8; 8]);
    assert_eq!(
        verify(&v.pubkey, &t, &long),
        Err(VerifyError::BadSignatureEncoding)
    );
    assert_eq!(
        verify(&v.pubkey, &t, &v.sig[..v.sig.len() - 1]),
        Err(VerifyError::BadSignatureEncoding)
    );
    assert_eq!(
        verify(&v.pubkey, &t, &[]),
        Err(VerifyError::BadSignatureEncoding)
    );
}

#[test]
fn replay_with_new_host_nonce_rejected() {
    let v = load();
    // Device signed (host_nonce, device_nonce) earlier; verifier now uses a fresh host nonce.
    let mut fresh = v.host_nonce;
    fresh[5] ^= 0xFF;
    let t_new = transcript(&fresh, &v.device_nonce, &v.device_id);
    assert_eq!(
        verify(&v.pubkey, &t_new, &v.sig),
        Err(VerifyError::BadSignature)
    );
    // And a signature produced over the different transcript verifies only for that one.
    let sig_new = testkey::sign(&t_new);
    assert_eq!(verify(&v.pubkey, &t_new, &sig_new), Ok(()));
    let t_old = transcript(&v.host_nonce, &v.device_nonce, &v.device_id);
    assert_eq!(
        verify(&v.pubkey, &t_old, &sig_new),
        Err(VerifyError::BadSignature)
    );
}

#[test]
fn apdu_encodings() {
    let v = load();
    let e = |k: &str| v.j[k].as_str().unwrap().to_string();
    assert_eq!(hx(&select_apdu()), e("select_apdu_hex"));
    assert_eq!(hx(&get_info_apdu()), e("get_info_apdu_hex"));
    let pin = v.j["pin_ascii"].as_str().unwrap().as_bytes();
    assert_eq!(hx(&enroll_apdu(pin).unwrap()), e("enroll_apdu_hex"));
    assert_eq!(hx(&revoke_apdu(pin).unwrap()), e("revoke_apdu_hex"));
    assert_eq!(hx(&challenge_apdu(&v.host_nonce)), e("challenge_apdu_hex"));
    assert_eq!(hx(&AID), "f04d4b4155544801");
}

#[test]
fn pin_bounds() {
    for len in [0usize, 5, 64, 255] {
        let pin = vec![b'1'; len];
        assert_eq!(enroll_apdu(&pin), Err(ProtoError::PinLength(len)));
        assert_eq!(revoke_apdu(&pin), Err(ProtoError::PinLength(len)));
    }
    for len in [6usize, 63] {
        let pin = vec![b'1'; len];
        assert_eq!(enroll_apdu(&pin).unwrap()[4] as usize, len);
        assert!(revoke_apdu(&pin).is_ok());
    }
}

#[test]
fn parsers() {
    let v = load();
    // info: unenrolled
    let mut u = vec![1, 0, 1];
    u.extend_from_slice(&v.device_id);
    let i = parse_info(&u).unwrap();
    assert!(!i.enrolled && i.pubkey.is_none() && i.device_id == v.device_id && i.policy == 1);
    // info: enrolled
    let mut e = vec![1, 1, 1];
    e.extend_from_slice(&v.device_id);
    e.extend_from_slice(&v.pubkey);
    let i = parse_info(&e).unwrap();
    assert!(i.enrolled && i.pubkey == Some(v.pubkey) && i.version == 1);
    // wrong lengths / values
    assert!(parse_info(&e[..e.len() - 1]).is_err());
    assert!(parse_info(&u[..18]).is_err());
    assert!(parse_info(&[u.clone(), vec![0]].concat()).is_err());
    let mut bad = e.clone();
    bad[0] = 2;
    assert_eq!(parse_info(&bad), Err(ProtoError::BadVersion(2)));
    bad = e.clone();
    bad[1] = 2;
    assert_eq!(parse_info(&bad), Err(ProtoError::BadState(2)));
    // policy must require user presence
    let mut nopol = u.clone();
    nopol[2] = 0;
    assert_eq!(parse_info(&nopol), Err(ProtoError::PolicyNoPresence(0)));
    // enroll
    let mut en = v.pubkey.to_vec();
    en.extend_from_slice(&v.device_id);
    let p = parse_enroll(&en).unwrap();
    assert_eq!((p.pubkey, p.device_id), (v.pubkey, v.device_id));
    assert!(parse_enroll(&en[..80]).is_err());
    assert!(parse_enroll(&[en, vec![0]].concat()).is_err());
    // challenge
    let mut c = v.device_nonce.to_vec();
    c.extend_from_slice(&v.sig);
    let p = parse_challenge(&c).unwrap();
    assert_eq!(
        (p.device_nonce, p.signature_der),
        (v.device_nonce, v.sig.clone())
    );
    assert!(parse_challenge(&c[..39]).is_err());
    assert!(parse_challenge(&[c.clone(), vec![0; 40]].concat()).is_err());
    assert!(parse_challenge(&[]).is_err());
}

#[test]
fn status_words() {
    assert_eq!(StatusWord::from(0x9000), StatusWord::Ok);
    assert_eq!(StatusWord::from(0x6300), StatusWord::NoUserPresence);
    assert_eq!(StatusWord::from(0x63C3), StatusWord::RetriesLeft(3));
    assert_eq!(StatusWord::from(0x63C0), StatusWord::RetriesLeft(0));
    assert_eq!(StatusWord::from(0x6985), StatusWord::WrongState);
    assert_eq!(StatusWord::from(0x6A80), StatusWord::WrongData);
    assert_eq!(StatusWord::from(0x1234), StatusWord::Other(0x1234));
    for sw in [
        0x9000u16, 0x6300, 0x63C8, 0x6700, 0x6982, 0x6983, 0x6985, 0x6A80, 0x6A86, 0x6D00, 0x6E00,
        0x6F00, 0x1234,
    ] {
        assert_eq!(u16::from(StatusWord::from(sw)), sw);
    }
    assert_eq!(
        split_response(&[1, 2, 0x90, 0]).unwrap(),
        (&[1u8, 2][..], StatusWord::Ok)
    );
    assert_eq!(split_response(&[0x90]), Err(ProtoError::NoStatusWord));
}

#[test]
fn device_name_validation() {
    use multikey_proto::{validate_device_name, NameError, NAME_MAX};
    assert_eq!(validate_device_name("Mew's Security Key"), Ok(()));
    assert_eq!(validate_device_name("A"), Ok(()));
    assert_eq!(validate_device_name(&"x".repeat(NAME_MAX)), Ok(()));
    assert_eq!(validate_device_name(""), Err(NameError::Empty));
    assert_eq!(
        validate_device_name(&"x".repeat(NAME_MAX + 1)),
        Err(NameError::TooLong(NAME_MAX + 1))
    );
    // Valid UTF-8 but not representable by the firmware's ASCII-only USB strings.
    assert_eq!(
        validate_device_name("Kh\u{f3}a"),
        Err(NameError::NotPrintableAscii('\u{f3}'))
    );
    assert_eq!(
        validate_device_name("key \u{1F511}"),
        Err(NameError::NotPrintableAscii('\u{1F511}'))
    );
    assert_eq!(
        validate_device_name("tab\there"),
        Err(NameError::NotPrintableAscii('\t'))
    );
    assert_eq!(
        validate_device_name("nul\0"),
        Err(NameError::NotPrintableAscii('\0'))
    );
    assert_eq!(validate_device_name(" lead"), Err(NameError::EdgeSpace));
    assert_eq!(validate_device_name("trail "), Err(NameError::EdgeSpace));
    assert_eq!(validate_device_name("in side"), Ok(()));
}

#[test]
fn device_name_apdus() {
    use multikey_proto::{
        device_name_clear_apdu, device_name_get_apdu, device_name_reenumerate_apdu,
        device_name_set_apdu,
    };
    assert_eq!(device_name_get_apdu(), [0x80, 0x06, 0x00, 0x00, 0x00]);
    // Unenrolled: empty PIN field.
    assert_eq!(
        device_name_set_apdu(&[], "Key", false).unwrap(),
        [0x80, 0x06, 0x01, 0x00, 0x04, 0x00, b'K', b'e', b'y', 0x00]
    );
    // Enrolled: pin_len | pin | name, P2 bit0 asks for re-enumeration.
    assert_eq!(
        device_name_set_apdu(b"123456", "Key", true).unwrap(),
        [
            0x80, 0x06, 0x01, 0x01, 0x0A, 0x06, b'1', b'2', b'3', b'4', b'5', b'6', b'K', b'e',
            b'y', 0x00
        ]
    );
    assert_eq!(
        device_name_clear_apdu(&[], false).unwrap(),
        [0x80, 0x06, 0x02, 0x00, 0x01, 0x00, 0x00]
    );
    assert_eq!(
        device_name_reenumerate_apdu(b"123456").unwrap(),
        [0x80, 0x06, 0x03, 0x00, 0x07, 0x06, b'1', b'2', b'3', b'4', b'5', b'6']
    );
    // A PIN that is neither empty nor 6..=63 bytes never reaches the wire; neither does a bad name.
    assert!(matches!(
        device_name_set_apdu(b"123", "Key", false),
        Err(ProtoError::PinLength(3))
    ));
    assert!(matches!(
        device_name_set_apdu(&[], "Kh\u{f3}a", false),
        Err(ProtoError::Name(_))
    ));
    // Longest legal command still fits one short APDU.
    let longest = device_name_set_apdu(&[b'p'; 63], &"n".repeat(31), true).unwrap();
    assert_eq!(longest[4] as usize, 1 + 63 + 31);
    assert_eq!(longest.len(), 5 + 1 + 63 + 31 + 1);
}

#[test]
fn device_name_response_parsing() {
    use multikey_proto::parse_device_name;
    let n = parse_device_name(&[0x07, b'A', b'B']).unwrap();
    assert!(n.custom && n.reenumeration_pending && n.rename_supported);
    assert_eq!(n.name, "AB");
    let n = parse_device_name(&[0x04, b'x']).unwrap();
    assert!(!n.custom && !n.reenumeration_pending && n.rename_supported);
    // Empty name, reserved flag bits, oversize and non-UTF-8 are all malformed.
    assert!(parse_device_name(&[0x04]).is_err());
    assert!(parse_device_name(&[0x08, b'x']).is_err());
    assert!(parse_device_name(&[[0x04].as_slice(), &[b'x'; 32]].concat()).is_err());
    assert!(parse_device_name(&[0x04, 0xFF, 0xFE]).is_err());
    assert!(parse_device_name(&[]).is_err());
}

#[test]
fn device_name_response_rejects_control_characters() {
    use multikey_proto::parse_device_name;
    assert_eq!(
        parse_device_name(b"\x04Plain Name").unwrap().name,
        "Plain Name"
    );
    assert!(parse_device_name(b"\x04a\x1b[31m").is_err());
    assert!(parse_device_name(b"\x04a\x7f").is_err());
    assert!(parse_device_name(b"\x04caf\xc3\xa9").is_err());
}
