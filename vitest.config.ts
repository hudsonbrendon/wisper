import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.{ts,tsx}"],
      // Entry shims, generated/d.ts, and the test harness aren't unit-tested.
      exclude: [
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/test/**",
        "src/vite-env.d.ts",
      ],
    },
  },
});
