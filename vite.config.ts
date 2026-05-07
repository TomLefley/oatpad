import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  server: { port: 5173, strictPort: true },
  // Component tests mount Svelte 5 components in jsdom; without the
  // "browser" condition the package exports map resolves the SSR build,
  // which trips on `mount()`.
  resolve: {
    conditions: ["browser"],
  },
  test: {
    environment: "node",
    include: ["src-web/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
