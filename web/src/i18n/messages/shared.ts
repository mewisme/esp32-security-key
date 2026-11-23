import { supportedFlashSizes } from "@/lib/firmware/policy";

/** "4, 8 or 16 MB": the flash sizes of tools/flash_policy.json, with the language's word for "or". */
export function flashSizeList(or: string): string {
  const sizes = supportedFlashSizes().map((s) => s.replace("MB", ""));
  return `${sizes.slice(0, -1).join(", ")} ${or} ${sizes.at(-1)} MB`;
}
