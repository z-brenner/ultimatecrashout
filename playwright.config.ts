import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4174);
/**
 * Serve the build under a sub-path by default: it proves the relative build
 * works on hosts such as GitHub Pages project sites. E2E_BASE_PATH=/ tests the
 * domain-root case. Tests navigate with relative URLs ("./?match=…").
 */
const basePath = (process.env.E2E_BASE_PATH ?? "/ultimatecrashout/").replace(/\/?$/, "/");

/**
 * Browser end-to-end tests run against the production build in dist/.
 * Run `npm run build` first; `npm run test:e2e` serves dist/ with vite preview.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}${basePath}`,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1280, height: 720 },
      launchOptions: { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] },
    },
  }],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort --base ${basePath}`,
    url: `http://127.0.0.1:${port}${basePath}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
