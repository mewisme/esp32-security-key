// FlashDriver over esptool-js (Web Serial). Never erases: writes go through writeFlash with eraseAll=false and only the
// regions the install decision lists; flash mode/frequency/size are kept so the written bytes equal the verified bytes.
import { ESPLoader, type IEspLoaderTerminal, Transport } from "esptool-js";
import type { ChipInfo, FlashDriver, PortInfo } from "./driver";
import { md5Hex } from "./md5";

export class EsptoolDriver implements FlashDriver {
  private port: SerialPort | null = null;
  private transport: Transport | null = null;
  private loader: ESPLoader | null = null;
  private lines: string[] = [];

  private get esp(): ESPLoader {
    if (!this.loader) throw new Error("not connected");
    return this.loader;
  }

  log(): string[] {
    return [...this.lines];
  }

  async requestPort(filters: SerialPortFilter[]): Promise<PortInfo> {
    this.port = await navigator.serial.requestPort({ filters });
    const info = this.port.getInfo();
    return { usbVendorId: info.usbVendorId, usbProductId: info.usbProductId };
  }

  async connect(): Promise<ChipInfo> {
    if (!this.port) throw new Error("no port selected");
    const terminal: IEspLoaderTerminal = {
      clean: () => {},
      writeLine: (data: string) => this.lines.push(data),
      write: (data: string) => this.lines.push(data),
    };
    this.transport = new Transport(this.port, false);
    this.loader = new ESPLoader({ transport: this.transport, baudrate: 460800, romBaudrate: 115200, terminal });
    await this.loader.main("default_reset");
    const chip = this.loader.chip;
    const mac = await chip.readMac(this.loader).catch(() => null);
    return {
      chipName: chip.CHIP_NAME,
      description: await chip.getChipDescription(this.loader),
      features: await chip.getChipFeatures(this.loader),
      mac,
      flashSize: (await this.loader.detectFlashSize()) ?? null,
      secureDownloadMode: this.loader.secureDownloadMode,
    };
  }

  readFlash(offset: number, length: number): Promise<Uint8Array> {
    return this.esp.readFlash(offset, length);
  }

  async write(writes: { offset: number; data: Uint8Array }[], onProgress: (written: number, total: number) => void): Promise<void> {
    const total = writes.reduce((n, w) => n + w.data.length, 0);
    const before = writes.map((_, i) => writes.slice(0, i).reduce((n, w) => n + w.data.length, 0));
    await this.esp.writeFlash({
      fileArray: writes.map((w) => ({ data: w.data, address: w.offset })),
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex, written, fileTotal) => {
        const size = writes[fileIndex]?.data.length ?? fileTotal;
        onProgress((before[fileIndex] ?? 0) + Math.round((written / Math.max(fileTotal, 1)) * size), total);
      },
      calculateMD5Hash: md5Hex,
    });
    onProgress(total, total);
  }

  md5(offset: number, length: number): Promise<string> {
    return this.esp.flashMd5sum(offset, length);
  }

  async reboot(): Promise<void> {
    await this.esp.after("hard_reset");
  }

  async disconnect(): Promise<void> {
    const t = this.transport;
    this.transport = null;
    this.loader = null;
    if (t) await t.disconnect();
  }

  onDisconnect(cb: () => void): () => void {
    const handler = (ev: Event) => {
      if ((ev.target as SerialPort | null) === this.port) cb();
    };
    navigator.serial.addEventListener("disconnect", handler);
    return () => navigator.serial.removeEventListener("disconnect", handler);
  }
}
