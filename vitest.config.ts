import { defineConfig } from "vitest/config";

// Only the repo's own tests. The app build stages a DMG whose Applications
// link points at /Applications, so a repo-wide scan would walk into other apps.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
