// The only surface through which the installer touches a board. Implemented by esptool-driver.ts (real hardware) and,
// in `vite build --mode e2e` only, by tests/e2e/fake-create-driver.ts.

export interface PortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface ChipInfo {
  chipName: string;
  description: string;
  features: string[];
  mac: string | null;
  flashSize: string | null;
  /** Quad-SPI or octal flash, read from eFuse on the ESP32-S3; null when it cannot be told. */
  flashType: "quad" | "octal" | null;
  secureDownloadMode: boolean;
}

export interface FlashDriver {
  requestPort(filters: SerialPortFilter[]): Promise<PortInfo>;
  connect(): Promise<ChipInfo>;
  readFlash(offset: number, length: number): Promise<Uint8Array>;
  write(writes: { offset: number; data: Uint8Array }[], onProgress: (written: number, total: number) => void): Promise<void>;
  md5(offset: number, length: number): Promise<string>;
  reboot(): Promise<void>;
  disconnect(): Promise<void>;
  onDisconnect(cb: () => void): () => void;
  /** Loader log lines for "Technical details". */
  log(): string[];
}
