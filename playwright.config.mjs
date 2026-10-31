import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:4173",
    trace: "off",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npx --yes serve . -l 4173",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: true,
      },
});
