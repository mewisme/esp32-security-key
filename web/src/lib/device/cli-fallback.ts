import type { NameRequest } from "./mkauth";

/** The same change with the host tools, for when the browser could not do it. Null when nothing was requested. */
export function cliFallback(request: NameRequest): string | null {
  if (request.mode === "default") return "multikey device reset-name --reenumerate";
  if (request.mode === "custom") return `multikey device rename "${request.name.replace(/(["\\])/g, "\\$1")}" --reenumerate`;
  return null;
}
