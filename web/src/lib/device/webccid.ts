// CCID over a vendor-class (0xFF) bulk interface. Chrome's WebUSB refuses the Smart Card class, so the firmware exposes a
// second interface running the same CCID parser (pico-keys-sdk/src/usb/ccid/ccid.c). Framing: 10-byte header
// bMessageType, dwLength (LE32), bSlot, bSeq, b7, b8, b9.
import { FirmwareError } from "../errors/firmware-error";
import { CCID_EVENT } from "./key-events";

const ICC_POWER_ON = 0x62;
const XFR_BLOCK = 0x6f;
const DATA_BLOCK = 0x80;
const HEADER = 10;
const POWER_ON_TIMEOUT_MS = 5000;
const MAX_KEPT_EVENTS = 32;

function header(type: number, len: number, seq: number): Uint8Array {
  return Uint8Array.from([type, len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff, 0, seq, 0, 0, 0]);
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(onTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * The key did not answer in time. It is not the key saying "button not pressed" (that is its status word 6300): the
 * command can be dropped, for instance while the computer's smart-card stack probes the other interface. Shown to the
 * user as "can't reach the key's management interface"; the rename flow catches it to read the name back instead.
 */
export class NoAnswerError extends FirmwareError {
  constructor(detail: string) {
    super("name-transport-unavailable", detail);
    this.name = "NoAnswerError";
  }
}

export class WebCcid {
  private seq = 0;
  private buf = new Uint8Array(0);
  private abandoned = false;
  private events: Uint8Array[] = [];

  private constructor(
    private readonly device: USBDevice,
    private readonly iface: number,
    private readonly epIn: number,
    private readonly epOut: number,
  ) {}

  static async open(device: USBDevice): Promise<WebCcid> {
    if (!device.opened) await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    let found: { iface: number; epIn: number; epOut: number } | null = null;
    for (const i of device.configuration?.interfaces ?? []) {
      const alt = i.alternate;
      if (alt.interfaceClass !== 0xff) continue;
      const bulkIn = alt.endpoints.find((e) => e.type === "bulk" && e.direction === "in");
      const bulkOut = alt.endpoints.find((e) => e.type === "bulk" && e.direction === "out");
      if (bulkIn && bulkOut) {
        found = { iface: i.interfaceNumber, epIn: bulkIn.endpointNumber, epOut: bulkOut.endpointNumber };
        break;
      }
    }
    if (!found) throw new FirmwareError("name-transport-unavailable", "no WebCCID interface");
    await device.claimInterface(found.iface);
    const ccid = new WebCcid(device, found.iface, found.epIn, found.epOut);
    try {
      await withTimeout(ccid.exchange(ICC_POWER_ON, new Uint8Array(0)), POWER_ON_TIMEOUT_MS, () => new FirmwareError("name-transport-unavailable", "IccPowerOn timed out"));
    } catch (e) {
      await ccid.close();
      throw e;
    }
    return ccid;
  }

  /**
   * One APDU. A timeout means "no answer" (not "the button was not pressed": that is the key's own status word 6300). The
   * abandoned exchange stops reading, otherwise it would swallow the next answer; the connection must then be reopened.
   */
  async transmit(apdu: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    return withTimeout(this.exchange(XFR_BLOCK, apdu), timeoutMs, () => {
      this.abandoned = true;
      return new NoAnswerError(`no answer within ${timeoutMs} ms`);
    });
  }

  async close(): Promise<void> {
    await this.device.releaseInterface(this.iface).catch(() => {});
    await this.device.close().catch(() => {});
  }

  /**
   * Event messages (passkey activity) that arrived while a command was in flight or at power-on: they were queued in the
   * key before anybody read them. Payloads only (the bytes after the CCID header), oldest first.
   */
  takeEvents(): Uint8Array[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /**
   * The payload of the next event message. Waits without a limit; WebUSB cannot cancel a pending read, so the caller ends a
   * wait by closing the connection (which makes the pending transfer fail). Other message types are skipped.
   */
  async nextEvent(): Promise<Uint8Array> {
    for (;;) {
      const m = await this.readMessage();
      if (m[0] === CCID_EVENT) return m.slice(HEADER);
    }
  }

  private keepEvent(m: Uint8Array): void {
    this.events.push(m.slice(HEADER));
    if (this.events.length > MAX_KEPT_EVENTS) this.events.shift();
  }

  private async exchange(type: number, payload: Uint8Array): Promise<Uint8Array> {
    const seq = this.seq;
    this.seq = (this.seq + 1) & 0xff;
    this.buf = new Uint8Array(0);
    const msg = new Uint8Array(HEADER + payload.length);
    msg.set(header(type, payload.length, seq));
    msg.set(payload, HEADER);
    await this.device.transferOut(this.epOut, msg);
    for (;;) {
      const m = await this.readMessage();
      if (m[0] === CCID_EVENT) {
        this.keepEvent(m);
        continue;
      }
      if (m[0] !== DATA_BLOCK || m[6] !== seq) continue;
      const len = m[1]! | (m[2]! << 8) | (m[3]! << 16) | (m[4]! * 0x1000000);
      if (m[7] === 0x80 && len === 0) continue; // time extension
      if ((m[7]! & 0x40) !== 0) throw new FirmwareError("name-failed", `CCID error 0x${(m[8] ?? 0).toString(16).padStart(2, "0")}`);
      return m.slice(HEADER);
    }
  }

  /** One complete CCID message (header + dwLength bytes); surplus bytes stay buffered. */
  private async readMessage(): Promise<Uint8Array> {
    for (;;) {
      if (this.buf.length >= HEADER) {
        const len = this.buf[1]! | (this.buf[2]! << 8) | (this.buf[3]! << 16) | (this.buf[4]! * 0x1000000);
        const total = HEADER + len;
        if (this.buf.length >= total) {
          const msg = this.buf.slice(0, total);
          this.buf = this.buf.slice(total);
          return msg;
        }
      }
      if (this.abandoned) throw new NoAnswerError("exchange abandoned after a timeout");
      const r = await this.device.transferIn(this.epIn, 1024);
      if (r.status !== "ok" || !r.data) throw new FirmwareError("name-failed", `USB transfer ${r.status}`);
      const chunk = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      const joined = new Uint8Array(this.buf.length + chunk.length);
      joined.set(this.buf);
      joined.set(chunk, this.buf.length);
      this.buf = joined;
    }
  }
}
