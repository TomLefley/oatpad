import { defineConfig } from "vitest/config";

// Local config so vitest does not climb up to the parent Oatpad vite
// config, which would pull the Svelte plugin into a Node-only test run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
