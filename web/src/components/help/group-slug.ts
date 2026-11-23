import type { ErrorGroup } from "@/lib/errors/catalog";

export function groupSlug(group: ErrorGroup): string {
  return `group-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
