// Shared Chrome launch for tests that load the unpacked extension.
// Branded Google Chrome ignores --load-extension. Playwright's headless shell
// cannot load extensions either. headless: false plus --headless=new uses the
// full Chromium build from `npx playwright install chromium`.
export function extensionContextOptions(ext, { extraArgs = [], viewport, deviceScaleFactor } = {}) {
  const options = {
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      "--autoplay-policy=no-user-gesture-required",
      ...extraArgs,
    ],
  };
  if (viewport) options.viewport = viewport;
  if (deviceScaleFactor) options.deviceScaleFactor = deviceScaleFactor;
  return options;
}
