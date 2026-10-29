import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./specs",
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  reporter: [["json", { outputFile: process.env.P2I_REPORT }], ["line"]],
  outputDir: process.env.P2I_ARTIFACTS,
  use: {
    baseURL: process.env.FRONTEND_URL,
    browserName: "chromium",
    channel: "chromium",
    trace: "retain-on-failure",
    screenshot: "on",
    headless: true,
  },
});
