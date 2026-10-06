const $ = (id) => document.getElementById(id);
let sessionId = null;
const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  "mobile-android": { width: 412, height: 915 },
  desktop: { width: 1366, height: 768 },
  "desktop-mac": { width: 1440, height: 900 },
};
let viewport = VIEWPORTS.mobile;

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function show(shot) {
  if (shot.url) $("url").value = shot.url;
  $("meta").textContent = `${shot.title || ""} · ${shot.url || ""} · ${shot.id || sessionId || ""}`;
  if (shot.screenshotBase64) {
    $("screen").src = "data:image/png;base64," + shot.screenshotBase64;
  }
  $("text").textContent = shot.text || "";
}

async function health() {
  try {
    const h = await api("/api/v1/health");
    $("health").textContent = h.ok ? `chromium · ${h.sessions} session` : "down";
  } catch {
    $("health").textContent = "API down";
  }
}

async function ensureSession() {
  const device = $("device").value || "mobile";
  viewport = VIEWPORTS[device] || VIEWPORTS.mobile;
  if (sessionId) return sessionId;
  const s = await api("/api/v1/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device,
      width: viewport.width,
      height: viewport.height,
    }),
  });
  sessionId = s.id;
  return sessionId;
}

$("device").addEventListener("change", async () => {
  if (sessionId) {
    await api(`/api/v1/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
    sessionId = null;
  }
});

$("bar").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("go").disabled = true;
  try {
    await ensureSession();
    const shot = await api(`/api/v1/sessions/${sessionId}/goto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: $("url").value }),
    });
    show(shot);
  } catch (err) {
    $("text").textContent = err.message;
  } finally {
    $("go").disabled = false;
    health();
  }
});

$("back").addEventListener("click", async () => {
  if (!sessionId) return;
  show(await api(`/api/v1/sessions/${sessionId}/back`, { method: "POST" }));
});
$("reload").addEventListener("click", async () => {
  if (!sessionId) return;
  show(await api(`/api/v1/sessions/${sessionId}/reload`, { method: "POST" }));
});
$("scroll").addEventListener("click", async () => {
  if (!sessionId) return;
  show(await api(`/api/v1/sessions/${sessionId}/scroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dy: 500 }),
  }));
});
$("frames").addEventListener("click", async () => {
  if (!sessionId) return;
  const data = await api(`/api/v1/sessions/${sessionId}/frames`);
  $("text").textContent = JSON.stringify(data.frames, null, 2);
});
$("shot").addEventListener("click", () => {
  if (!sessionId) return;
  $("screen").src = `/api/v1/sessions/${sessionId}/screenshot?t=${Date.now()}`;
});
$("close").addEventListener("click", async () => {
  if (!sessionId) return;
  await api(`/api/v1/sessions/${sessionId}`, { method: "DELETE" });
  sessionId = null;
  $("screen").removeAttribute("src");
  $("text").textContent = "";
  $("meta").textContent = "session closed";
  health();
});

$("screen").addEventListener("click", async (e) => {
  if (!sessionId) return;
  const img = e.target;
  const rect = img.getBoundingClientRect();
  const x = Math.round(((e.clientX - rect.left) / rect.width) * viewport.width);
  const y = Math.round(((e.clientY - rect.top) / rect.height) * viewport.height);
  try {
    show(await api(`/api/v1/sessions/${sessionId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    }));
  } catch (err) {
    $("text").textContent = err.message;
  }
});

$("apiHint").textContent = `POST /api/v1/sessions/:id/wait-for-selector { selector, frameSelector, timeout }
GET  /api/v1/sessions/:id/screenshot
GET  /api/v1/sessions/:id/frames
POST /api/v1/sessions/:id/click { selector, frameSelector }
POST /api/v1/sessions/:id/type { selector, text, frameSelector }
POST /api/v1/sessions/:id/evaluate { script }
POST /api/v1/sessions/:id/press { key }
POST /api/v1/sessions/:id/select { selector, value }
POST /api/v1/sessions/:id/inspect { selector }
GET  /api/v1/sessions/:id/logs
POST /api/v1/sessions/:id/upload { selector, files }`;

health();
