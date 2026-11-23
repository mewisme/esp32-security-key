import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { contentTypeFor, isAllowedAsset } from "./worker/routes.ts";

const here = import.meta.dirname;

/**
 * Dev only: serve a locally packaged firmware directory (tools/package_firmware.py output with
 * `manifest --tag local`) as release "local", so the installer can be tried against a board before a release exists.
 *   MULTIKEYS_LOCAL_FIRMWARE=../build-pkgtest pnpm dev
 */
function localFirmwarePlugin(): Plugin {
  return {
    name: "multikeys-local-firmware",
    apply: "serve",
    configureServer(server) {
      const dir = process.env.MULTIKEYS_LOCAL_FIRMWARE;
      if (!dir) return;
      const root = resolve(dir);
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (req.method !== "GET") return next();
        if (url.pathname === "/api/releases") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify([
              { tag: "local", name: "Local test build", prerelease: true, published_at: null, html_url: null },
            ]),
          );
          return;
        }
        const m = /^\/api\/firmware\/local\/([^/]+)$/.exec(url.pathname);
        if (!m) return next();
        const name = m[1] ?? "";
        const file = join(root, name);
        if (!isAllowedAsset("local", name) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end('{"error":"not_found"}');
          return;
        }
        res.setHeader("Content-Type", contentTypeFor(name));
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [localFirmwarePlugin(), react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: [
      ...(mode === "e2e"
        ? [
            {
              find: "@/lib/flashing/create-driver",
              replacement: resolve(here, "tests/e2e/fake-create-driver.ts"),
            },
            {
              find: "@/lib/device/create-usb-checker",
              replacement: resolve(here, "tests/e2e/fake-create-usb-checker.ts"),
            },
          ]
        : []),
      { find: "@", replacement: resolve(here, "src") },
    ],
  },
  server: {
    fs: { allow: [here, resolve(here, "../tools/flash_policy.json")] },
  },
}));
