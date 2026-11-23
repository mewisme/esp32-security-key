import { describe, expect, it } from "vitest";
import { algorithmName, CCID_EVENT, ctapErrorName, parseKeyEvent, sanitizeText, userPresent, userVerified } from "@/lib/device/key-events";

// The same frames as host/multikey-proto/tests/events.rs: 10-byte CCID header (7F, LE32 length, ...), then the payload.
const MAKE_CREDENTIAL = "7f290000000000010000010129010a6769746875622e636f6d0205616c6963650308416c69636520412e0404fffffff9050145";
const GET_ASSERTION_FAILED = "7f190000000000010000020219010b6578616d706c652e6f726705010107010206012e";
const BUTTON_WAIT = "7f120000000000010000030012080101010a6769746875622e636f6d";

function payload(frameHex: string): Uint8Array {
  const b = Uint8Array.from(frameHex.match(/../g)!.map((h) => Number.parseInt(h, 16)));
  expect(b[0]).toBe(CCID_EVENT);
  const len = b[1]! | (b[2]! << 8);
  expect(b.length).toBe(10 + len);
  return b.subarray(10);
}

describe("parseKeyEvent", () => {
  it("decodes a registered passkey", () => {
    const e = parseKeyEvent(payload(MAKE_CREDENTIAL));
    expect(e).toMatchObject({ op: "make-credential", result: "ok", rpId: "github.com", userName: "alice", userDisplayName: "Alice A.", algorithm: -7, authFlags: 0x45 });
    expect(algorithmName(-7)).toBe("ES256");
    expect(userPresent(e)).toBe(true);
    expect(userVerified(e)).toBe(true);
  });

  it("decodes a failed sign-in with its CTAP2 error", () => {
    const e = parseKeyEvent(payload(GET_ASSERTION_FAILED));
    expect(e).toMatchObject({ op: "get-assertion", result: "error", rpId: "example.org", credentialCount: 2, error: 0x2e });
    expect(ctapErrorName(0x2e)).toBe("NO_CREDENTIALS");
    expect(userVerified(e)).toBe(false);
  });

  it("decodes a button wait and the operation that needs the press", () => {
    expect(parseKeyEvent(payload(BUTTON_WAIT))).toMatchObject({ op: "user-presence", result: "pending", operation: "make-credential", rpId: "github.com" });
  });

  it("skips fields it does not know and rejects malformed payloads", () => {
    expect(parseKeyEvent(Uint8Array.from([1, 1, 7, 0x7e, 2, 0xaa, 0xbb])).rpId).toBeUndefined();
    expect(() => parseKeyEvent(Uint8Array.from([1, 1, 9]))).toThrow(); // declared length differs
    expect(() => parseKeyEvent(Uint8Array.from([1, 1]))).toThrow();
    expect(() => parseKeyEvent(Uint8Array.from([1, 1, 6, 1, 9, 0x78]))).toThrow(); // field longer than the payload
    expect(() => parseKeyEvent(Uint8Array.from([1, 1, 7, 5, 2, 0, 0]))).toThrow(); // flags field of the wrong size
  });
});

describe("sanitizeText", () => {
  it("replaces control and bidirectional-formatting characters", () => {
    const s = sanitizeText(Uint8Array.from([0x61, 0x1b, 0x5b, 0x33, 0x31, 0x6d, 0xe2, 0x80, 0xae, 0x63, 0xe2, 0x82]));
    expect(s).not.toContain("\u001b");
    expect(s).not.toContain("\u202e");
    expect(s.startsWith("a")).toBe(true);
    expect(s).toContain("c");
  });
});
