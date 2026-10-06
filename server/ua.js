const PRESETS = {
  mobile: {
    device: "mobile",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  "mobile-ios": {
    device: "mobile-ios",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  "mobile-android": {
    device: "mobile-android",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.100 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  },
  desktop: {
    device: "desktop",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.100 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    isMobile: false,
    hasTouch: false,
  },
  "desktop-mac": {
    device: "desktop-mac",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.100 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
  },
};

function resolveDevice(opts = {}) {
  const key = String(opts.device || opts.ua || opts.profile || "mobile").toLowerCase();
  const preset = PRESETS[key] || PRESETS.mobile;
  const viewport = {
    width: Number(opts.width) || preset.viewport.width,
    height: Number(opts.height) || preset.viewport.height,
  };
  return {
    device: preset.device,
    userAgent: opts.userAgent || preset.userAgent,
    viewport,
    isMobile: preset.isMobile,
    hasTouch: preset.hasTouch,
  };
}

function listPresets() {
  return Object.values(PRESETS).map((p) => ({
    device: p.device,
    userAgent: p.userAgent,
    viewport: p.viewport,
    isMobile: p.isMobile,
  }));
}

module.exports = { PRESETS, resolveDevice, listPresets };
