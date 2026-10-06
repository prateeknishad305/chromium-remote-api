# Remote Playwright API

Server-side Chromium. Phone clients call REST; they do not run Playwright or Chromium.

```bash
npm start
```

## One-shot browse

```javascript
const r = await fetch('/api/v1/browse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com' })
});
const { sessionId, title, url, text, screenshotBase64, status } = await r.json();
```

## Session

```javascript
const { id } = await fetch('/api/v1/sessions', { method: 'POST' }).then(r => r.json());
await fetch('/api/v1/sessions/' + id + '/goto', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com' })
});
```

See `docs/API.md`.
