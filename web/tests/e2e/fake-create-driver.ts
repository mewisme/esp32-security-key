// e2e-only FlashDriver: a simulated ESP32-S3 whose flash is a sparse map. Swapped in by vite.config.ts in --mode e2e.
import type { ChipInfo, FlashDriver, PortInfo } from "@/lib/flashing/driver";
import { md5Hex } from "@/lib/flashing/md5";
import { parseAppDescriptor } from "@/lib/flashing/app-descriptor";
import { appImage, partitionTable } from "../fixtures/firmware";
import { readScenario } from "./scenario";

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

class FakeDriver implements FlashDriver {
  private s = readScenario();
  private flash = new Map<number, Uint8Array>();
  private listeners = new Set<() => void>();
  private lines: string[] = [];

  constructor() {
    const d = this.s.device ?? "blank";
    // A bootloader image header (e9, segments, dio, flash size | 80 MHz) for every board that already runs something.
    const sizeNibble = ({ "4MB": 2, "8MB": 3 } as Record<string, number>)[this.s.flashSize ?? "16MB"] ?? 4;
    if (d !== "blank") this.flash.set(0, Uint8Array.from([0xe9, 3, 2, (sizeNibble << 4) | 0xf]));
    if (d === "fido-0.1.0-dev" || d === "fido-0.2.0") {
      this.flash.set(0x8000, partitionTable());
      this.flash.set(0x20000, appImage(d === "fido-0.2.0" ? "0.2.0" : "0.1.0-dev"));
    } else if (d === "fido-0.3.1" || d === "openpgp-0.3.1") {
      this.flash.set(0x8000, partitionTable());
      this.flash.set(0x20000, appImage("0.3.1", d === "fido-0.3.1" ? "multikey-fido" : "multikey-openpgp"));
    } else if (d === "fido-0.3.3" || d === "fido-0.3.3-current") {
      this.flash.set(0x8000, partitionTable());
      const app = appImage("0.3.3");
      // "-current" is byte-identical to what the fake release v0.3.3 publishes (fixtures/firmware.ts pack sets image header bytes 2-3).
      if (d === "fido-0.3.3-current") app.set([0x02, (sizeNibble << 4) | 0xf], 2);
      this.flash.set(0x20000, app);
    } else if (d === "fido-garbled") {
      // An application whose descriptor is unreadable, as after an interrupted write.
      this.flash.set(0x8000, partitionTable());
      this.flash.set(0x20000, new Uint8Array(0x4000).fill(0x5a));
    } else if (d === "foreign") {
      this.flash.set(0x8000, partitionTable({ part0Offset: 0x310000 }));
      this.flash.set(0x20000, appImage("1.0.0", "esp-factory-demo"));
    }
  }

  log() {
    return [...this.lines];
  }

  async requestPort(): Promise<PortInfo> {
    Reflect.set(window, "__portRequests", (Number(Reflect.get(window, "__portRequests")) || 0) + 1);
    await sleep(20);
    if (this.s.chooser === "cancel") throw Object.assign(new Error("No port selected by the user."), { name: "NotFoundError" });
    return this.s.port === "uart" ? { usbVendorId: 0x10c4, usbProductId: 0xea60 } : { usbVendorId: 0x303a, usbProductId: 0x1001 };
  }

  async connect(): Promise<ChipInfo> {
    await sleep(50);
    this.lines.push("fake: connecting");
    if (this.s.connectError) throw new Error("Failed to connect with the device");
    const chipName = this.s.chip ?? "ESP32-S3";
    return {
      chipName,
      description: `${chipName} (QFN56) (revision v0.2)`,
      features: this.s.features ?? ["Wi-Fi", "BLE", "Embedded PSRAM 8MB (AP_3v3)"],
      mac: "80:b5:4e:c8:22:78",
      flashSize: this.s.flashSize === undefined ? "16MB" : this.s.flashSize,
      flashType: chipName === "ESP32-S3" ? (this.s.flashType === undefined ? "quad" : this.s.flashType) : null,
      secureDownloadMode: false,
    };
  }

  async readFlash(offset: number, length: number): Promise<Uint8Array> {
    const out = new Uint8Array(length).fill(0xff);
    for (const [at, data] of this.flash) {
      const start = Math.max(at, offset);
      const end = Math.min(at + data.length, offset + length);
      if (start < end) out.set(data.subarray(start - at, end - at), start - offset);
    }
    return out;
  }

  async write(writes: { offset: number; data: Uint8Array }[], onProgress: (written: number, total: number) => void): Promise<void> {
    const total = writes.reduce((n, w) => n + w.data.length, 0);
    let done = 0;
    for (const w of writes) {
      const chunk = Math.max(4096, Math.ceil(total / 20));
      for (let pos = 0; pos < w.data.length; pos += chunk) {
        await sleep(this.s.writeDelayMs ?? 15);
        done += Math.min(chunk, w.data.length - pos);
        if (this.s.disconnectAt !== undefined && done / total >= this.s.disconnectAt) {
          for (const l of this.listeners) l();
          throw new Error("The device has been lost.");
        }
        onProgress(done, total);
      }
      const recorded: unknown = Reflect.get(window, "__flashWrites");
      const offsets = Array.isArray(recorded) ? recorded : [];
      offsets.push(w.offset);
      Reflect.set(window, "__flashWrites", offsets);
      this.flash.set(w.offset, w.data.slice());
      if (w.offset === 0x20000) {
        // What a real key would report from BUILD_INFO once it runs this image (read by fake-create-key-connector.ts).
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", w.data as Uint8Array<ArrayBuffer>));
        const desc = parseAppDescriptor(w.data.subarray(0, 256));
        Reflect.set(window, "__flashedApp", {
          sha256: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(""),
          version: desc?.version ?? "",
          project: desc?.project_name ?? "",
        });
      }
    }
  }

  async md5(offset: number, length: number): Promise<string> {
    return md5Hex(await this.readFlash(offset, length));
  }

  async reboot(): Promise<void> {
    await sleep(20);
  }

  async disconnect(): Promise<void> {}

  onDisconnect(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export function createDriver(): FlashDriver {
  return new FakeDriver();
}
