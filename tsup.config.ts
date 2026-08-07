import { defineConfig } from "tsup";

const shared = {
  entry: ["src/cli.ts"],
  target: "node20" as const,
  splitting: false,
  shims: true,
  banner: { js: "#!/usr/bin/env node" },
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
