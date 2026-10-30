import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

const shared = {
  entry: ["src/cli.ts"],
  target: "node20" as const,
  splitting: false,
  shims: true,
  banner: { js: "#!/usr/bin/env node" },
  define: { SKILLSET_VERSION: JSON.stringify(version) },
};

export default defineConfig([
  {
    ...shared,
    format: ["esm"],
    outDir: "dist",
    clean: true,
  },
  {
    ...shared,
    // Skillset.app has no adjacent node_modules tree. A bundled CommonJS
    // artifact can still require Node built-ins while remaining standalone.
    format: ["cjs"],
    outDir: "dist-app",
    outExtension: () => ({ js: ".cjs" }),
    clean: true,
    noExternal: [/.*/],
  },
]);
