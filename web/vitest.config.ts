import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const here = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: "@", replacement: resolve(here, "src") }] },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "jsdom",
  },
});
