// A running key over WebUSB: identity (USB strings, read-only) and the MKAUTH management channel
// (WebCCID). Re-enumeration after a rename is awaited through navigator.usb connect/disconnect events.
import { FirmwareError } from "../errors/firmware-error";
import type { DeviceCheck } from "../flashing/machine";
import { type KeyEvent, parseKeyEvent } from "./key-events";
import { NoAnswerError, WebCcid } from "./webccid";

/** Events that arrive this soon after the interface is claimed were already queued in the key. */
const BACKLOG_WINDOW_MS = 500;

export interface KeyConnection {
  identity(): Promise<DeviceCheck>;
  /** Commands run one at a time. While `watchEvents` listens there is no command channel: this rejects with SessionBusyError. */
  transmit(apdu: Uint8Array, timeoutMs: number): Promise<Uint8Array>;
  waitForReenumeration(timeoutMs: number): Promise<void>;
  /**
   * Passkey activity the key reports (registration, sign-in, button wait). Events the key had queued come first, flagged
   * `backlog`; then live ones until `signal` aborts. The session cannot send commands meanwhile. The promise settles only
   * after the interface has been released, so an operation started next never reads at the same time.
   */
  watchEvents(onEvent: (event: KeyEvent, backlog: boolean) => void, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

export interface KeyConnector {
  supported(): boolean;
  connect(vid: number, pid: number): Promise<KeyConnection>;
}

/** A second operation was asked for while one owns the session (a command while listening, or two listeners). A caller mistake, not a device fault. */
export class SessionBusyError extends Error {
  constructor(what: string) {
    super(`the key session is busy: ${what}`);
    this.name = "SessionBusyError";
  }
}

interface Watcher {
  /** Set once the listener was told to stop; its cleanup may still be running. */
  stopped: boolean;
  stop(): void;
  /** Resolves after the listener released the interface. */
  finished: Promise<void>;
}

class WebUsbKeyConnection implements KeyConnection {
  private ccid: WebCcid | null = null;
  /** The release of the last claimed interface; a new claim waits for it, so two sessions never overlap. */
  private closing: Promise<void> = Promise.resolve();
  /** Commands run one after another: each starts when the previous settled. */
  private chain: Promise<unknown> = Promise.resolve();
  private watcher: Watcher | null = null;

  constructor(private device: USBDevice) {}

  async identity(): Promise<DeviceCheck> {
    const dev = this.device;
    return { productName: dev.productName ?? null, manufacturerName: dev.manufacturerName ?? null, serialNumber: dev.serialNumber ?? null };
  }

  transmit(apdu: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    return this.serial(async () => {
      await this.watcherCleanup();
      if (this.watcher) throw new SessionBusyError("it is listening for events; stop watching first");
      this.ccid ??= await this.openCcid();
      try {
        return await this.ccid.transmit(apdu, timeoutMs);
      } catch (e) {
        // The key stopped answering (it can drop a command while another interface is probing it): the abandoned exchange
        // must not keep reading, so the next call starts over with a fresh claim of the interface.
        if (e instanceof NoAnswerError) await this.closeCcid();
        throw e;
      }
    });
  }

  async waitForReenumeration(timeoutMs: number): Promise<void> {
    if (this.watcher && !this.watcher.stopped) throw new SessionBusyError("it is listening for events; stop watching first");
    const serial = this.device.serialNumber;
    const usb = navigator.usb;
    // Listeners are attached synchronously, before anything is awaited, so no event can be missed.
    const wait = new Promise<void>((resolve, reject) => {
      let disconnected = false;
      const done = (fn: () => void) => {
        clearTimeout(timer);
        usb.removeEventListener("connect", onConnect);
        usb.removeEventListener("disconnect", onDisconnect);
        fn();
      };
      const onConnect = (e: Event) => {
        const d = (e as USBConnectionEvent).device;
        if (d.serialNumber === serial) done(() => {
          this.device = d;
          resolve();
        });
      };
      const onDisconnect = (e: Event) => {
        if ((e as USBConnectionEvent).device.serialNumber !== serial) return;
        disconnected = true;
        // The device may already be back by the time the event is delivered.
        void usb.getDevices().then((list) => {
          const back = list.find((d) => d.serialNumber === serial);
          if (disconnected && back) done(() => {
            this.device = back;
            resolve();
          });
        }, () => {});
      };
      const timer = setTimeout(
        () => done(() => reject(new FirmwareError("name-not-verified", `the key did not reappear within ${timeoutMs} ms`))),
        timeoutMs,
      );
      usb.addEventListener("connect", onConnect);
      usb.addEventListener("disconnect", onDisconnect);
    });
    await this.serial(async () => {
      await this.watcherCleanup();
      await this.closeCcid();
      await this.device.close().catch(() => {});
    });
    return wait;
  }

  async watchEvents(onEvent: (event: KeyEvent, backlog: boolean) => void, signal: AbortSignal): Promise<void> {
    // A listener that was told to stop is cleaned up first, and the commands in flight settle: nothing else reads.
    await this.quiesce();
    if (this.watcher) throw new SessionBusyError("it is already listening for events");
    const ctl = new AbortController();
    let finish!: () => void;
    const watcher: Watcher = {
      stopped: false,
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      stop: () => {
        watcher.stopped = true;
        ctl.abort();
      },
    };
    // Registered before anything is awaited, so a command asked for from now on is refused instead of reading as well.
    this.watcher = watcher;
    const onExternal = () => watcher.stop();
    if (signal.aborted) watcher.stop();
    else signal.addEventListener("abort", onExternal, { once: true });
    try {
      this.ccid ??= await this.openCcid();
      const ccid = this.ccid;
      // Whatever the key had queued is delivered within moments of claiming the interface; later events happened while
      // this page was watching. The key cannot say when a queued event happened, so the page does not pretend to know.
      const backlogUntil = Date.now() + BACKLOG_WINDOW_MS;
      const deliver = (payload: Uint8Array) => {
        try {
          onEvent(parseKeyEvent(payload), Date.now() < backlogUntil);
        } catch {
          // A malformed event is dropped: it must not end the watch.
        }
      };
      for (const payload of ccid.takeEvents()) deliver(payload);
      // A pending WebUSB read cannot be cancelled: closing the session makes it fail, which ends the loop.
      const onAbort = () => void this.closeCcid();
      ctl.signal.addEventListener("abort", onAbort, { once: true });
      try {
        while (!ctl.signal.aborted) deliver(await ccid.nextEvent());
      } catch (e) {
        if (!ctl.signal.aborted) throw e;
      } finally {
        ctl.signal.removeEventListener("abort", onAbort);
      }
    } finally {
      signal.removeEventListener("abort", onExternal);
      // Settles only after the interface is released: whatever runs next opens its own claim and its own reads.
      await this.closeCcid();
      this.watcher = null;
      finish();
    }
  }

  async close(): Promise<void> {
    this.watcher?.stop();
    // Closing the claim also ends a command that is waiting for an answer, instead of waiting for its timeout.
    await this.closeCcid();
    await this.quiesce();
    await this.serial(async () => {
      await this.closeCcid();
      await this.device.close().catch(() => {});
    });
  }

  /** Runs `fn` after every earlier command settled, whatever the outcome. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  /** Waits for a listener that was told to stop to finish releasing the interface. */
  private async watcherCleanup(): Promise<void> {
    while (this.watcher?.stopped) await this.watcher.finished;
  }

  /** Waits until nothing touches the session: the commands in flight and the cleanup of a stopped listener. */
  private async quiesce(): Promise<void> {
    await this.chain;
    await this.watcherCleanup();
  }

  private closeCcid(): Promise<void> {
    const c = this.ccid;
    this.ccid = null;
    if (c) this.closing = this.closing.then(() => c.close());
    return this.closing;
  }

  private async openCcid(): Promise<WebCcid> {
    await this.closing;
    try {
      return await WebCcid.open(this.device);
    } catch (e) {
      // After a USB re-enumeration the device object held here can be stale: use the one the browser knows now.
      const list = await navigator.usb.getDevices().catch(() => [] as USBDevice[]);
      const current = list.find((d) => d.serialNumber === this.device.serialNumber);
      if (!current || current === this.device) throw e;
      this.device = current;
      return WebCcid.open(this.device);
    }
  }
}

export class WebUsbKeyConnector implements KeyConnector {
  supported(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.usb?.requestDevice === "function";
  }

  async connect(vid: number, pid: number): Promise<KeyConnection> {
    const dev = await navigator.usb.requestDevice({ filters: [{ vendorId: vid, productId: pid }] });
    return new WebUsbKeyConnection(dev);
  }
}
