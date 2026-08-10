# Deploying Pricely

The app is 100% static — no build step, no server, no database. Any static
host works. Both options below are free and neither needs a domain name.

## Option A — Netlify (fastest: drag and drop)

1. Go to https://app.netlify.com/drop  (sign in with Google/GitHub, free)
2. Drag THIS WHOLE FOLDER (netlify-deploy) onto the page
3. Done. You get a URL like  https://something-random.netlify.app
   — rename it under Site settings → Change site name, e.g.
   https://pricely.netlify.app

## Option B — Cloudflare Pages (same as the devbhoomi realtors site)

1. Go to https://dash.cloudflare.com → Workers & Pages → Create → Pages
   → "Upload assets"
2. Name the project (this becomes the URL: <name>.pages.dev)
3. Upload the files in this folder
4. Done: https://<name>.pages.dev

Both give you HTTPS automatically, which is required for:
- the service worker (offline use)
- "Add to Home Screen" install on her iPhone

## After it's live, on her iPhone

Open the URL in Safari → Share button → "Add to Home Screen".
It opens full-screen like a real app and works offline.

## When you have a domain later

Netlify: Site settings → Domain management → Add custom domain.
Cloudflare Pages: Custom domains tab → Set up a domain.
Nothing in the app needs to change.

## Updating the app

Rebuild (`node build.mjs` in the project), copy the new dist/index.html
over the old one, and re-upload the folder the same way. The in-app
service worker will pick up the new version on next open.

## One caution about data

Her data lives in the phone's browser storage (localStorage), per device.
Clearing Safari website data erases it — use the in-app "Export backup"
button (Dashboard → Export backup) regularly. Cloud sync is a future
milestone in the design document.
