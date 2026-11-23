// The USB product name a key can be given. Mirrors multikey_name_valid() in components/multikey_auth: 1-31 bytes, each
// 0x20..0x7E, no leading or trailing space (docs/PROTOCOLS.md).
export const DEVICE_NAME_MAX = 31;
export const FALLBACK_DEFAULT_NAME = "MultiKeys Security Key";

export type NameProblem = "empty" | "too-long" | "not-ascii" | "edge-space";

export function validateDeviceName(name: string): NameProblem | null {
  if (name.length === 0) return "empty";
  if (name.length > DEVICE_NAME_MAX) return "too-long";
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return "not-ascii";
  }
  if (name.startsWith(" ") || name.endsWith(" ")) return "edge-space";
  return null;
}

export const NAME_PROBLEM_TEXT: Record<NameProblem, string> = {
  empty: "Enter a name (1–31 characters).",
  "too-long": "Use at most 31 characters.",
  "not-ascii": "Use plain ASCII letters, digits, spaces and punctuation only (no accents or emoji).",
  "edge-space": "Remove spaces at the start or end.",
};
