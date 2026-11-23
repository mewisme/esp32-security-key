import { useCallback, useEffect, useState } from "react";
import type { CatalogState } from "@/hooks/useInstaller";
import { fetchCatalog } from "@/lib/firmware/catalog";

/** Release catalog for the read-only pages, with a retry (the shared `useCatalog` has none). */
export function useReleaseCatalog(): { catalog: CatalogState; reload: () => void } {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    fetchCatalog()
      .then((c) => live && setCatalog({ status: "ready", catalog: c }))
      .catch((e: unknown) => live && setCatalog({ status: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [attempt]);
  const reload = useCallback(() => {
    setCatalog({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { catalog, reload };
}
