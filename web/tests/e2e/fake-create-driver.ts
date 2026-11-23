// e2e-only FlashDriver: a simulated ESP32-S3 whose flash is a sparse map. Swapped in by vite.config.ts in --mode e2e.
import type { ChipInfo, FlashDriver, PortInfo } from "@/lib/flashing/driver";
import { md5Hex } from "@/lib/flashing/md5";
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
    if (d === "fido-0.1.0-dev" || d === "fido-0.2.0") {
      this.flash.set(0x8000, partitionTable());
      this.flash.set(0x20000, appImage(d === "fido-0.2.0" ? "0.2.0" : "0.1.0-dev"));
    } else if (d === "foreign") {
      this.flash.set(0x8000, partitionTable({ part0Offset: 0x310000 }));
      this.flash.set(0x20000, appImage("1.0.0", "esp-factory-demo"));
    }
  }

  log() {
    return [...this.lines];
  }

  async requestPort(): Promise<PortInfo> {
    await sleep(20);
    if (this.s.chooser === "cancel") throw Object.assign(new Error("No port selected by the user."), { name: "NotFoundError" });
    return this.s.port === "uart" ? { usbVendorId: 0x10c4, usbProductId: 0xea60 } : { usbVendorId: 0x303a, usbProductId: 0x1001 };
  }

  async connect(): Promise<ChipInfo> {
    await sleep(50);
    this.lines.push("fake: connecting");
    if (this.s.connectError) throw new Error("Failed to connect with the device");
    return {
      chipName: this.s.chip ?? "ESP32-S3",
      description: `${this.s.chip ?? "ESP32-S3"} (QFN56) (revision v0.2)`,
      features: ["WiFi", "BLE", "Embedded PSRAM 8MB (AP_3v3)"],
      mac: "80:b5:4e:c8:22:78",
      flashSize: this.s.flashSize === undefined ? "16MB" : this.s.flashSize,
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
        await sleep(15);
        done += Math.min(chunk, w.data.length - pos);
        if (this.s.disconnectAt !== undefined && done / total >= this.s.disconnectAt) {
          for (const l of this.listeners) l();
          throw new Error("The device has been lost.");
        }
        onProgress(done, total);
      }
      this.flash.set(w.offset, w.data.slice());
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
