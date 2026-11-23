// Downloads one firmware package and proves it is exactly what the manifest describes before anything is flashed.
import { unzipSync } from "fflate";
import { FirmwareError } from "../errors/firmware-error";
import type { Build, ImageRole } from "./types";

export interface DownloadedImage {
  role: ImageRole;
  offset: number;
  data: Uint8Array;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

async function readAll(res: Response, total: number, onProgress: (received: number, total: number) => void): Promise<Uint8Array> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress(buf.length, total);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received > total) throw new FirmwareError("checksum-mismatch", `download is larger than the ${total} bytes listed in the manifest`);
    onProgress(received, total);
  }
  const out = new Uint8Array(received);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/** Package bytes -> verified images. Throws checksum-mismatch or manifest-invalid; never returns partial data. */
export async function verifyPackage(zip: Uint8Array, build: Build): Promise<DownloadedImage[]> {
  if (zip.length !== build.package.size || (await sha256Hex(zip)) !== build.package.sha256) {
    throw new FirmwareError("checksum-mismatch", `${build.package.name}: size or SHA-256 differs from the manifest`);
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch (e) {
    throw new FirmwareError("manifest-invalid", `cannot open ${build.package.name}: ${String(e)}`);
  }
  const root = build.package.name.replace(/\.zip$/, "");
  const members = ["bootloader.bin", "partition-table.bin", ...build.images.filter((i) => i.role === "app").map((i) => i.file),
    "firmware.json", "SHA256SUMS", "LICENSE", "NOTICE.txt", "README.txt"].map((n) => `${root}/${n}`).sort();
  const names = Object.keys(files).filter((n) => !n.endsWith("/")).sort();
  if (names.join("\n") !== members.join("\n")) {
    throw new FirmwareError("manifest-invalid", `unexpected package contents: ${names.join(", ")}`);
  }
  const images: DownloadedImage[] = [];
  for (const img of build.images) {
    const data = files[`${root}/${img.file}`]!;
    if (data.length !== img.size || (await sha256Hex(data)) !== img.sha256) {
      throw new FirmwareError("checksum-mismatch", `${img.file}: size or SHA-256 differs from the manifest`);
    }
    images.push({ role: img.role, offset: img.offset, data });
  }
  let fw: unknown;
  try {
    fw = JSON.parse(new TextDecoder().decode(files[`${root}/firmware.json`]));
  } catch {
    throw new FirmwareError("manifest-invalid", "firmware.json is not JSON");
  }
  // firmware.json is the entry exactly as published (schema 1 or 2), not the normalised `build`.
  const { package: _pkg, ...entry } = build.entry;
  void _pkg;
  if (canonical(fw) !== canonical(entry)) throw new FirmwareError("manifest-invalid", "firmware.json differs from the manifest");
  return images.sort((a, b) => a.offset - b.offset);
}

export async function downloadBuild(
  tag: string,
  build: Build,
  onProgress: (received: number, total: number) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadedImage[]> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/firmware/${encodeURIComponent(tag)}/${encodeURIComponent(build.package.name)}`);
  } catch (e) {
    throw new FirmwareError("firmware-unavailable", String(e));
  }
  if (!res.ok) throw new FirmwareError("firmware-unavailable", `HTTP ${res.status} for ${build.package.name}`);
  const zip = await readAll(res, build.package.size, onProgress);
  return verifyPackage(zip, build);
}
