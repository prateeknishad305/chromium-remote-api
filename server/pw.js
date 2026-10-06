const express = require("express");
const cors = require("cors");
const path = require("path");
const { chromium } = require("playwright");
const { randomUUID } = require("crypto");
const { timeoutOf, listFrames, resolveScope, waitLocator } = require("./frames");
const { resolveDevice, listPresets } = require("./ua");

const PORT = Number(process.env.PORT) || 5173;
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS) || 5;
const IDLE_MS = Number(process.env.IDLE_MS) || 10 * 60 * 1000;
const GOTO_MS = 30000;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

let browser = null;
const sessions = new Map();

function publicUrl(req, url) {
  try {
    const u = new URL(url, "http://invalid");
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "about:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  return browser;
}

function touch(session) {
  session.lastUsed = Date.now();
}

function dto(session) {
  return {
    id: session.id,
    url: session.url,
    title: session.title,
    createdAt: session.createdAt,
    lastUsed: new Date(session.lastUsed).toISOString(),
    viewport: session.viewport,
    device: session.device,
    userAgent: session.userAgent,
    isMobile: session.isMobile,
  };
}

async function snapshot(session) {
  const page = session.page;
  session.url = page.url();
  session.title = await page.title().catch(() => "");
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const png = await page.screenshot({ type: "png", fullPage: false });
  return {
    ...dto(session),
    text: text.slice(0, 20000),
    screenshotBase64: png.toString("base64"),
  };
}

async function createSession(opts = {}) {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (oldest) await closeSession(oldest.id);
  }
  const b = await getBrowser();
  const profile = resolveDevice(opts);
  const viewport = profile.viewport;
  const context = await b.newContext({
    viewport,
    userAgent: profile.userAgent,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    javaScriptEnabled: true,
  });
  const page = await context.newPage();
  const id = randomUUID();
  const logs = [];
  page.on("console", (msg) => {
    logs.push({ type: "console", level: msg.type(), text: msg.text(), ts: Date.now() });
    if (logs.length > 500) logs.shift();
  });
  page.on("pageerror", (err) => {
    logs.push({ type: "pageerror", level: "error", text: err.message, ts: Date.now() });
    if (logs.length > 500) logs.shift();
  });
  page.on("requestfailed", (req) => {
    logs.push({
      type: "requestfailed",
      level: "error",
      text: `${req.method()} ${req.url()} ${req.failure() && req.failure().errorText}`,
      ts: Date.now(),
    });
    if (logs.length > 500) logs.shift();
  });
  const session = {
    id,
    context,
    page,
    viewport,
    device: profile.device,
    userAgent: profile.userAgent,
    isMobile: profile.isMobile,
    url: "about:blank",
    title: "",
    createdAt: new Date().toISOString(),
    lastUsed: Date.now(),
    logs,
  };
  sessions.set(id, session);
  return session;
}

async function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  sessions.delete(id);
  await session.context.close().catch(() => {});
  return true;
}

function getSession(req, res) {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return null;
  }
  touch(session);
  return session;
}

setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (now - s.lastUsed > IDLE_MS) closeSession(s.id);
  }
}, 30000);

app.get("/api/v1/ua", (req, res) => {
  res.json({ presets: listPresets() });
});

app.get("/api/v1/health", async (req, res) => {
  try {
    await getBrowser();
    res.json({
      ok: true,
      service: "remote-playwright",
      engine: "chromium",
      sessions: sessions.size,
      maxSessions: MAX_SESSIONS,
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
});

app.post("/api/v1/sessions", async (req, res) => {
  try {
    const session = await createSession(req.body || {});
    res.status(201).json(dto(session));
  } catch (err) {
    actionFail(res, err);
  }
});

app.get("/api/v1/sessions", (req, res) => {
  res.json({ sessions: [...sessions.values()].map(dto) });
});

app.get("/api/v1/sessions/:id", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  res.json(dto(session));
});

app.delete("/api/v1/sessions/:id", async (req, res) => {
  const ok = await closeSession(req.params.id);
  if (!ok) return res.status(404).json({ error: "session not found" });
  res.json({ ok: true });
});

app.post("/api/v1/sessions/:id/goto", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const url = publicUrl(req, req.body && req.body.url);
  if (!url) return res.status(400).json({ error: "http(s) url required" });
  try {
    const nav = await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_MS });
    await session.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const shot = await snapshot(session);
    res.json({
      ...shot,
      status: nav ? nav.status() : 0,
    });
  } catch (err) {
    actionFail(res, err, { url: session.page.url() });
  }
});

function actionFail(res, err, extra = {}) {
  res.status(200).json({
    ok: false,
    error: err && err.message ? err.message : String(err),
    ...extra,
  });
}

async function afterAction(session, opts = {}) {
  await session.page.waitForTimeout(Math.min(Number(opts.settleMs) || 250, 2000)).catch(() => {});
  if (opts.screenshot === false) {
    session.url = session.page.url();
    session.title = await session.page.title().catch(() => "");
    return { ...dto(session), ok: true, screenshotBase64: null, text: "" };
  }
  try {
    return { ok: true, ...(await snapshot(session)) };
  } catch (err) {
    session.url = session.page.url();
    return { ok: true, ...dto(session), screenshotError: err.message, text: "", screenshotBase64: null };
  }
}

async function clickLocator(loc, timeout) {
  const t = Math.min(timeout || 8000, 12000);
  try {
    await loc.click({ timeout: t });
    return "click";
  } catch {
    try {
      await loc.click({ timeout: Math.min(t, 5000), force: true });
      return "force";
    } catch {
      await loc.evaluate((el) => el.click());
      return "js";
    }
  }
}

app.post("/api/v1/sessions/:id/wait-for-selector", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const body = req.body || {};
  const selector = body.selector;
  if (!selector) return res.status(400).json({ error: "selector required" });
  const timeout = timeoutOf(body, 15000);
  const state = body.state || "visible";
  try {
    const scope = await resolveScope(session.page, body);
    await waitLocator(scope, selector, timeout, state);
    res.json({ ok: true, selector, state, timeout, frames: listFrames(session.page) });
  } catch (err) {
    actionFail(res, err, { frames: listFrames(session.page) });
  }
});

app.get("/api/v1/sessions/:id/screenshot", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  try {
    const fullPage = String(req.query.fullPage || "") === "true";
    const png = await session.page.screenshot({ type: "png", fullPage });
    if (String(req.query.format || "") === "json") {
      return res.json({ screenshotBase64: png.toString("base64"), url: session.page.url() });
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(png);
  } catch (err) {
    actionFail(res, err);
  }
});

app.get("/api/v1/sessions/:id/frames", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  res.json({ frames: listFrames(session.page) });
});

async function evalTarget(page, body = {}) {
  if (body.frameSelector) {
    const handle = await page.$(body.frameSelector);
    const frame = handle ? await handle.contentFrame() : null;
    if (!frame) throw new Error("frame not found for frameSelector");
    return frame;
  }
  if (body.frameName) {
    const named = page.frame({ name: body.frameName });
    if (named) return named;
  }
  if (body.frameUrl) {
    const byUrl = page.frame({ url: body.frameUrl });
    if (byUrl) return byUrl;
  }
  const frames = page.frames();
  if (typeof body.frame === "number" && frames[body.frame]) return frames[body.frame];
  return page;
}

app.post("/api/v1/sessions/:id/evaluate", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const body = req.body || {};
  const script = body.script || body.expression || body.js;
  if (!script || typeof script !== "string") return res.status(400).json({ error: "script required" });
  try {
    const target = await evalTarget(session.page, body);
    const result = await target.evaluate(script);
    res.json({ ok: true, result });
  } catch (err) {
    actionFail(res, err);
  }
});

app.post("/api/v1/sessions/:id/click", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const body = req.body || {};
  const { selector, x, y } = body;
  const timeout = timeoutOf(body, 8000);
  try {
    let how = "mouse";
    if (selector) {
      const scope = await resolveScope(session.page, body);
      const loc = await waitLocator(scope, selector, timeout, body.state || "visible");
      how = await clickLocator(loc, timeout);
    } else if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
      await session.page.mouse.click(Number(x), Number(y));
    } else {
      return res.status(400).json({ error: "selector or x,y required" });
    }
    const shot = await afterAction(session, { screenshot: body.screenshot !== false, settleMs: body.settleMs });
    res.json({ ...shot, click: how });
  } catch (err) {
    actionFail(res, err, { frames: listFrames(session.page) });
  }
});

app.post("/api/v1/sessions/:id/type", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const body = req.body || {};
  const { selector, text } = body;
  if (typeof text !== "string") return res.status(400).json({ error: "text required" });
  const timeout = timeoutOf(body, 15000);
  try {
    if (selector) {
      const scope = await resolveScope(session.page, body);
      const loc = await waitLocator(scope, selector, timeout, body.state || "visible");
      await loc.fill(text, { timeout });
    } else {
      await session.page.keyboard.type(text);
    }
    res.json(await afterAction(session, { screenshot: body.screenshot !== false }));
  } catch (err) {
    actionFail(res, err, { frames: listFrames(session.page) });
  }
});

app.post("/api/v1/sessions/:id/press", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const body = req.body || {};
  const key = body.key;
  if (!key) return res.status(400).json({ error: "key required" });
  const timeout = timeoutOf(body, 15000);
  try {
    if (body.selector) {
      const scope = await resolveScope(session.page, body);
      const loc = await waitLocator(scope, body.selector, timeout, body.state || "visible");
      await loc.press(key, { timeout });
    } else {
      await session.page.keyboard.press(key);
    }
    res.json(await afterAction(session, { screenshot: body.screenshot !== false }));
  } catch (err) {
    actionFail(res, err, { frames: listFrames(session.page) });
  }
});

app.post("/api/v1/sessions/:id/select", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const body = req.body || {};
  const selector = body.selector;
  if (!selector) return res.status(400).json({ error: "selector required" });
  const timeout = timeoutOf(body, 15000);
  const values = body.values || body.value;
  try {
    const scope = await resolveScope(session.page, body);
    const loc = await waitLocator(scope, selector, timeout, body.state || "visible");
    let selected;
    if (body.label != null) selected = await loc.selectOption({ label: body.label }, { timeout });
    else if (body.index != null) selected = await loc.selectOption({ index: Number(body.index) }, { timeout });
    else if (values != null) selected = await loc.selectOption(values, { timeout });
    else return res.status(400).json({ error: "value, label, or index required" });
    const shot = await afterAction(session, { screenshot: body.screenshot !== false });
    res.json({ ...shot, selected });
  } catch (err) {
    actionFail(res, err, { frames: listFrames(session.page) });
  }
});

app.post("/api/v1/sessions/:id/scroll", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const body = req.body || {};
  const dy = Number(body.dy || 400);
  const dx = Number(body.dx || 0);
  try {
    if (body.selector) {
      const scope = await resolveScope(session.page, body);
      const loc = await waitLocator(scope, body.selector, timeoutOf(body, 8000), "attached");
      await loc.scrollIntoViewIfNeeded();
    } else {
      await session.page.mouse.wheel(dx, dy);
    }
    res.json(await afterAction(session, { screenshot: body.screenshot !== false }));
  } catch (err) {
    actionFail(res, err);
  }
});

app.post("/api/v1/sessions/:id/wait-for-load", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const state = (req.body && req.body.state) || "networkidle";
  const timeout = timeoutOf(req.body, 15000);
  try {
    await session.page.waitForLoadState(state, { timeout });
    res.json(await afterAction(session));
  } catch (err) {
    actionFail(res, err);
  }
});

app.get("/api/v1/sessions/:id/html", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  try {
    const scope = await resolveScope(session.page, req.query || {});
    let html;
    if (scope.kind === "frame") html = await scope.root.content();
    else html = await session.page.content();
    if (String(req.query.format || "") === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    }
    res.json({ url: session.page.url(), html: html.slice(0, 400000), frames: listFrames(session.page) });
  } catch (err) {
    actionFail(res, err);
  }
});

app.post("/api/v1/sessions/:id/inspect", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const body = req.body || {};
  const selector = body.selector;
  if (!selector) return res.status(400).json({ error: "selector required" });
  try {
    const scope = await resolveScope(session.page, body);
    const loc = await waitLocator(scope, selector, timeoutOf(body, 8000), "attached");
    const info = await loc.evaluate((el) => ({
      tag: el.tagName,
      id: el.id,
      name: el.getAttribute("name"),
      type: el.getAttribute("type"),
      value: el.value,
      text: (el.innerText || "").slice(0, 2000),
      href: el.getAttribute("href"),
      visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      rect: el.getBoundingClientRect().toJSON(),
    }));
    res.json({ ok: true, selector, ...info });
  } catch (err) {
    actionFail(res, err, { frames: listFrames(session.page) });
  }
});

app.get("/api/v1/sessions/:id/logs", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  res.json({ logs: session.logs || [] });
});

app.post("/api/v1/sessions/:id/upload", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const body = req.body || {};
  const selector = body.selector;
  if (!selector) return res.status(400).json({ error: "selector required" });
  const files = body.files;
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: "files[] required ({ name, mimeType, bufferBase64 })" });
  }
  try {
    const payloads = files.map((f) => ({
      name: f.name || "file.bin",
      mimeType: f.mimeType || "application/octet-stream",
      buffer: Buffer.from(f.bufferBase64 || f.bodyBase64 || "", "base64"),
    }));
    const scope = await resolveScope(session.page, body);
    const loc = await waitLocator(scope, selector, timeoutOf(body, 15000), "attached");
    await loc.setInputFiles(payloads);
    res.json(await afterAction(session, { screenshot: body.screenshot !== false }));
  } catch (err) {
    actionFail(res, err, { frames: listFrames(session.page) });
  }
});

app.post("/api/v1/sessions/:id/back", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  try {
    await session.page.goBack({ waitUntil: "domcontentloaded", timeout: GOTO_MS }).catch(() => {});
    res.json(await afterAction(session));
  } catch (err) {
    actionFail(res, err);
  }
});

app.post("/api/v1/sessions/:id/reload", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  try {
    await session.page.reload({ waitUntil: "domcontentloaded", timeout: GOTO_MS });
    res.json(await afterAction(session));
  } catch (err) {
    actionFail(res, err);
  }
});

app.get("/api/v1/sessions/:id/page", async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  try {
    const html = await session.page.content();
    const shot = await afterAction(session);
    res.json({ ...shot, html: html.slice(0, 200000) });
  } catch (err) {
    actionFail(res, err);
  }
});

app.get("/api/v1/sessions/:id/screenshot.png", async (req, res) => {
  req.query = req.query || {};
  const session = getSession(req, res);
  if (!session) return;
  try {
    const png = await session.page.screenshot({ type: "png", fullPage: String(req.query.fullPage || "") === "true" });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(png);
  } catch (err) {
    actionFail(res, err);
  }
});

app.post("/api/v1/browse", async (req, res) => {
  const url = publicUrl(req, req.body && req.body.url);
  if (!url) return res.status(400).json({ error: "http(s) url required" });
  let session;
  try {
    session = await createSession(req.body || {});
    const nav = await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_MS });
    await session.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const shot = await snapshot(session);
    res.json({
      ok: true,
      sessionId: session.id,
      status: nav ? nav.status() : 0,
      ...shot,
    });
  } catch (err) {
    if (session) await closeSession(session.id);
    actionFail(res, err);
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "not found" });
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(200).json({ ok: false, error: err && err.message ? err.message : "error" });
});

app.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(`Remote Playwright API on ${PORT}\n`);
});
