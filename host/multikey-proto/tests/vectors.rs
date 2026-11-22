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
    assert_eq!(StatusWord::from(0x1234), StatusWord::Other(0x1234));
    for sw in [
        0x9000u16, 0x6300, 0x63C8, 0x6700, 0x6982, 0x6983, 0x6985, 0x6A86, 0x6D00, 0x6E00, 0x6F00,
        0x1234,
    ] {
        assert_eq!(u16::from(StatusWord::from(sw)), sw);
    }
    assert_eq!(
        split_response(&[1, 2, 0x90, 0]).unwrap(),
        (&[1u8, 2][..], StatusWord::Ok)
    );
    assert_eq!(split_response(&[0x90]), Err(ProtoError::NoStatusWord));
}
