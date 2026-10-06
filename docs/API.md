# Remote Playwright API

Phone pe Chromium nahi. Server page kholta hai. Click/type **iframe + wait-for-selector** ke saath.

Shared body fields (click, type, press, select, wait-for-selector, inspect, upload):

```json
{
  "selector": "#card-number",
  "timeout": 15000,
  "state": "visible",
  "frameSelector": "iframe[name=stripe_checkout]",
  "frameName": "stripe_checkout",
  "frameUrl": "https://js.stripe.com/**",
  "frame": 1
}
```

`frameSelector` Playwright `frameLocator` hai (nested iframes ke liye best). Slow iframes ke liye pehle wait.

## P0
- `POST /api/v1/sessions/:id/wait-for-selector`
- `GET /api/v1/sessions/:id/screenshot` PNG (`?fullPage=true`, `?format=json`)
- `POST /api/v1/sessions/:id/click` waits then clicks (frame ok)
- `POST /api/v1/sessions/:id/type` waits then fill (frame ok)

## P1
- `GET /api/v1/sessions/:id/frames`
- `POST /api/v1/sessions/:id/evaluate` `{ "script": "document.title", "frameSelector": "iframe" }`
- `POST /api/v1/sessions/:id/press` `{ "key": "Enter", "selector": "input" }`
- `POST /api/v1/sessions/:id/select` `{ "selector": "select[name=country]", "value": "IN" }` or `label` / `index`

## P2
- `POST /api/v1/sessions/:id/scroll` `{ "dy": 400 }` or `{ "selector": "#el" }`
- `POST /api/v1/sessions/:id/wait-for-load` `{ "state": "networkidle" }`
- `GET /api/v1/sessions/:id/html`
- `POST /api/v1/sessions/:id/inspect` `{ "selector": "button" }`

## P3
- `GET /api/v1/sessions/:id/logs`
- `GET /api/v1/sessions`
- `POST /api/v1/sessions/:id/upload` `{ "selector": "input[type=file]", "files": [{ "name": "a.png", "mimeType": "image/png", "bufferBase64": "..." }] }`

## Session / browse
- `POST /api/v1/browse` `{ "url": "https://example.com" }`
- `POST /api/v1/sessions` `{ "width": 390, "height": 844 }`
- `POST /api/v1/sessions/:id/goto`
- `POST /api/v1/sessions/:id/back`
- `POST /api/v1/sessions/:id/reload`
- `DELETE /api/v1/sessions/:id`
- `GET /api/v1/health`

## Stripe iframe example

```javascript
await fetch(`/api/v1/sessions/${id}/wait-for-selector`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    frameSelector: 'iframe[name=stripe_checkout]',
    selector: 'input[name=cardNumber]',
    timeout: 20000
  })
});
await fetch(`/api/v1/sessions/${id}/type`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    frameSelector: 'iframe[name=stripe_checkout]',
    selector: 'input[name=cardNumber]',
    text: '4242424242424242'
  })
});
```
