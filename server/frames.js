function timeoutOf(body, fallback = 15000) {
  const n = Number(body && (body.timeout ?? body.wait));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function frameQuery(body = {}) {
  return {
    frame: body.frame,
    frameSelector: body.frameSelector || body.iframe || body.frameCss,
    frameName: body.frameName || body.name,
    frameUrl: body.frameUrl,
  };
}

function listFrames(page) {
  return page.frames().map((f, index) => ({
    index,
    name: f.name() || "",
    url: f.url(),
    parentUrl: f.parentFrame() ? f.parentFrame().url() : null,
    isMain: f === page.mainFrame(),
  }));
}

async function resolveScope(page, body = {}) {
  const q = frameQuery(body);
  if (q.frameSelector) {
    return { kind: "locator", root: page.frameLocator(q.frameSelector), frame: q };
  }
  const frames = page.frames();
  let frame = page.mainFrame();
  if (typeof q.frame === "number" && frames[q.frame]) frame = frames[q.frame];
  else if (typeof q.frame === "string" && /^\d+$/.test(q.frame) && frames[Number(q.frame)]) {
    frame = frames[Number(q.frame)];
  }
  if (q.frameName) {
    const named = page.frame({ name: q.frameName });
    if (named) frame = named;
  }
  if (q.frameUrl) {
    const byUrl = page.frame({ url: q.frameUrl });
    if (byUrl) frame = byUrl;
  }
  if (q.frameSelector || q.frameName || q.frameUrl || q.frame != null) {
    return { kind: "frame", root: frame, frame: q };
  }
  return { kind: "page", root: page, frame: q };
}

async function waitLocator(scope, selector, timeout, state = "visible") {
  if (!selector) throw new Error("selector required");
  if (scope.kind === "locator") {
    const loc = scope.root.locator(selector);
    await loc.waitFor({ state, timeout });
    return loc;
  }
  if (scope.kind === "frame") {
    await scope.root.waitForSelector(selector, { state, timeout });
    return scope.root.locator(selector);
  }
  await scope.root.waitForSelector(selector, { state, timeout });
  return scope.root.locator(selector);
}

module.exports = { timeoutOf, frameQuery, listFrames, resolveScope, waitLocator };
