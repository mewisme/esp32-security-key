// A minimal CBOR decoder (RFC 8949) for what WebAuthn hands the page: an attestationObject and a COSE key. It knows the
// definite-length forms of major types 0 to 5 (unsigned, negative, bytes, text, array, map); anything else throws.
// Maps come back as `Map<unknown, unknown>` because COSE keys are integers.

export interface CborPrefix {
  value: unknown;
  /** Bytes the first item occupies, so a caller can read what follows it. */
  length: number;
}

const MAX_DEPTH = 16;

function fail(): never {
  throw new Error("cbor");
}

function read(bytes: Uint8Array, start: number, depth: number): CborPrefix {
  if (depth > MAX_DEPTH || start >= bytes.length) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const initial = bytes[start]!;
  const major = initial >> 5;
  const info = initial & 0x1f;
  let pos = start + 1;
  let arg: number;
  if (info < 24) {
    arg = info;
  } else if (info === 24 || info === 25 || info === 26 || info === 27) {
    const size = 1 << (info - 24);
    if (pos + size > bytes.length) fail();
    if (size === 1) arg = view.getUint8(pos);
    else if (size === 2) arg = view.getUint16(pos);
    else if (size === 4) arg = view.getUint32(pos);
    else {
      arg = view.getUint32(pos) * 2 ** 32 + view.getUint32(pos + 4);
      if (!Number.isSafeInteger(arg)) fail();
    }
    pos += size;
  } else {
    // 28..30 are reserved and 31 is the indefinite length, which WebAuthn's canonical CBOR never uses.
    return fail();
  }

  switch (major) {
    case 0:
      return { value: arg, length: pos - start };
    case 1:
      return { value: -1 - arg, length: pos - start };
    case 2:
    case 3: {
      if (pos + arg > bytes.length) fail();
      const slice = bytes.slice(pos, pos + arg);
      pos += arg;
      return { value: major === 2 ? slice : new TextDecoder("utf-8", { fatal: true }).decode(slice), length: pos - start };
    }
    case 4: {
      const items: unknown[] = [];
      for (let i = 0; i < arg; i++) {
        const item = read(bytes, pos, depth + 1);
        items.push(item.value);
        pos += item.length;
      }
      return { value: items, length: pos - start };
    }
    case 5: {
      const map = new Map<unknown, unknown>();
      for (let i = 0; i < arg; i++) {
        const key = read(bytes, pos, depth + 1);
        pos += key.length;
        const val = read(bytes, pos, depth + 1);
        pos += val.length;
        map.set(key.value, val.value);
      }
      return { value: map, length: pos - start };
    }
    default:
      return fail();
  }
}

/** Decodes the first item of `bytes` and says how many bytes it took. Throws `Error("cbor")` on anything it does not know. */
export function decodeCborPrefix(bytes: Uint8Array): CborPrefix {
  return read(bytes, 0, 0);
}

/** Decodes `bytes` as exactly one item. */
export function decodeCbor(bytes: Uint8Array): unknown {
  const { value, length } = decodeCborPrefix(bytes);
  if (length !== bytes.length) fail();
  return value;
}
