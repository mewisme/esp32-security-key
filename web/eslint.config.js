import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".wrangler", "node_modules", "playwright-report", "test-results", "worker-configuration.d.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // shadcn/ui components export variants next to components; main.tsx is the entry (no HMR boundary); the dictionaries
    // are data modules whose JSX values are not components.
    files: ["src/components/ui/**/*.tsx", "src/main.tsx", "src/i18n/messages/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    // ReUI components are installed as shipped and never edited (their style and behaviour belong to the registry).
    // Upstream code predates these React lint rules: it exports variants next to components and reads refs in useMemo.
    files: ["src/components/reui/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
);
