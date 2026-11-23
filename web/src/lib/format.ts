export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

export function formatHex(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(5, "0")}`;
}
