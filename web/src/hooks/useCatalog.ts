import { useEffect, useState } from "react";
import { fetchCatalog } from "@/lib/firmware/catalog";
import type { CatalogState } from "./useInstaller";

/** Release catalog for the read-only pages (home teaser, releases list). */
export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    fetchCatalog()
      .then((catalog) => live && setState({ status: "ready", catalog }))
      .catch((e: unknown) => live && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}
