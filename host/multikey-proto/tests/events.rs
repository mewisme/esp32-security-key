//! Live events (pico-fido `event_send`, delivered as CCID_EVENT messages). The frames below are built from the layout in
//! `docs/PROTOCOLS.md`; web/tests/unit/key-events.test.ts decodes the same bytes.
use multikey_proto::events::*;
use multikey_proto::ProtoError;

const MAKE_CREDENTIAL: &str = "7f290000000000010000010129010a6769746875622e636f6d0205616c6963650308416c69636520412e0404fffffff9050145";
const GET_ASSERTION_FAILED: &str =
    "7f190000000000010000020219010b6578616d706c652e6f726705010107010206012e";
const BUTTON_WAIT: &str = "7f120000000000010000030012080101010a6769746875622e636f6d";

fn bytes(h: &str) -> Vec<u8> {
    hex::decode(h).unwrap()
}

#[test]
fn make_credential() {
    let events = EventReader::new().feed(&bytes(MAKE_CREDENTIAL));
    assert_eq!(events.len(), 1);
    let e = events.into_iter().next().unwrap().unwrap();
    assert_eq!(e.op, EventOp::MakeCredential);
    assert_eq!(e.result, EventResult::Ok);
    assert_eq!(e.rp_id.as_deref(), Some("github.com"));
    assert_eq!(e.user_name.as_deref(), Some("alice"));
    assert_eq!(e.user_display_name.as_deref(), Some("Alice A."));
    assert_eq!(e.algorithm, Some(-7));
    assert_eq!(algorithm_name(-7), Some("ES256"));
    assert_eq!(e.auth_flags, Some(0x45)); // UP | UV | AT
    assert_eq!(e.user_present(), Some(true));
    assert_eq!(e.user_verified(), Some(true));
}

#[test]
fn failed_get_assertion() {
    let e = EventReader::new()
        .feed(&bytes(GET_ASSERTION_FAILED))
        .remove(0)
        .unwrap();
    assert_eq!(e.op, EventOp::GetAssertion);
    assert_eq!(e.result, EventResult::Error);
    assert_eq!(e.rp_id.as_deref(), Some("example.org"));
    assert_eq!(e.credential_count, Some(2));
    assert_eq!(e.error, Some(0x2E));
    assert_eq!(ctap_error_name(0x2E), Some("no credentials"));
    assert_eq!(e.user_verified(), Some(false));
}

#[test]
fn button_wait_names_the_operation() {
    let e = EventReader::new()
        .feed(&bytes(BUTTON_WAIT))
        .remove(0)
        .unwrap();
    assert_eq!(e.op, EventOp::UserPresence);
    assert_eq!(e.result, EventResult::Pending);
    assert_eq!(e.operation, Some(EventOp::MakeCredential));
    assert_eq!(e.rp_id.as_deref(), Some("github.com"));
}

#[test]
fn messages_split_across_reads_and_glued_together() {
    let mut all = bytes(MAKE_CREDENTIAL);
    all.extend(bytes(BUTTON_WAIT));
    all.extend(bytes(GET_ASSERTION_FAILED));
    // Byte by byte, as a 64-byte endpoint can deliver them.
    let mut r = EventReader::new();
    let mut got = Vec::new();
    for chunk in all.chunks(7) {
        got.extend(r.feed(chunk));
    }
    let ops: Vec<_> = got.into_iter().map(|e| e.unwrap().op).collect();
    assert_eq!(
        ops,
        [
            EventOp::MakeCredential,
            EventOp::UserPresence,
            EventOp::GetAssertion
        ]
    );
}

#[test]
fn other_messages_are_skipped() {
    // A DataBlock (0x80) reply carrying 2 bytes, then a real event.
    let mut stream = vec![0x80, 2, 0, 0, 0, 0, 5, 0, 0, 0, 0x90, 0x00];
    stream.extend(bytes(BUTTON_WAIT));
    let events = EventReader::new().feed(&stream);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].as_ref().unwrap().op, EventOp::UserPresence);
}

#[test]
fn malformed_payloads_are_errors() {
    // Declared total length differs from the real one.
    assert!(parse_event(&[1, 1, 9]).is_err());
    assert!(parse_event(&[1, 1]).is_err());
    // A field claiming more bytes than the payload holds.
    assert!(parse_event(&[1, 1, 6, 1, 9, b'x']).is_err());
    // A flags field of the wrong size.
    assert!(parse_event(&[1, 1, 7, 5, 2, 0, 0]).is_err());
    // A message length out of range desynchronises the reader instead of waiting for gigabytes.
    let events = EventReader::new().feed(&[0x7F, 0xFF, 0xFF, 0xFF, 0x7F, 0, 0, 0, 0, 0]);
    assert!(matches!(events[0], Err(ProtoError::BadLength { .. })));
}

#[test]
fn unknown_fields_are_skipped() {
    let e = parse_event(&[1, 1, 7, 0x7E, 2, 0xAA, 0xBB]).unwrap();
    assert_eq!(e.op, EventOp::MakeCredential);
    assert_eq!(e.rp_id, None);
}

#[test]
fn text_from_a_relying_party_is_made_printable() {
    // ESC, a right-to-left override and a cut-off UTF-8 sequence.
    let s = sanitize_text(b"a\x1b[31mb\xE2\x80\xAEc\xE2\x82");
    assert!(
        !s.chars().any(|c| c.is_control() || c == '\u{202E}'),
        "{s:?}"
    );
    assert!(s.starts_with('a') && s.contains('b') && s.contains('c'));
}
