# Burg dashboard

Astro dashboard hosted on Cloudflare Workers at https://burg.gitor.uk/. It displays weather, greenhouse and irrigation readings, sensor history, and panorama/entrance camera galleries in German, English, or Italian.

## Local development and verification

Use Node.js 22.12 or newer:

```sh
npm ci
npm run dev
npm test
npm run build
npm audit
```

Tests mock every upstream request, including image deletion. They do not modify cameras, stored images, or production services.

Local live readings require the Cloudflare secrets `HISTORY_API_TOKEN` and `UPLOAD_SECRET` for their respective routes. Missing credentials return a JSON 503 response; charts display an error rather than claiming a connection. Keep secrets in Cloudflare or a git-ignored `.dev.vars` file; never commit them. Previewing without secrets is useful for checking unavailable-data states.

## Data and image routes

- `/api/status` combines the existing `/ha-history-api/v1/live-status` and `/ha-history-api/v1/site-status` upstreams.
- `/api/temperature?entity_id=...` accepts the registered sensor aliases, normalizes readings, and preserves zero values. Invalid or missing samples are omitted from plots rather than interpreted as zero.
- `/api/delete-image` retains single-image deletion and prefix-scoped deletion for `mountain_` and `entrance_`. Missing targets, unknown prefixes, path traversal, and explicit cross-origin browser requests are rejected.
- The catch-all `/api/[...path]` compatibility proxy still forwards arbitrary methods and paths to the existing homelab host. Bodies are streamed so binary responses are preserved. Confirm external consumers before narrowing or removing this route.

## Security findings that still need configuration

**Image deletion is not authenticated by the application.** Cross-origin and filename validation do not authenticate a caller. Preserve this functionality only behind an appropriate Cloudflare Access policy or add server-side authorization before treating it as safe for public access. The audit intentionally preserved deletion at the owner's request. No production deletion requests were made during testing.

The general compatibility proxy also has no application authentication. Review its exposure and required methods/paths at the edge; upstream services must enforce their own authorization.

Compatible dependency updates were applied. The remaining audit findings require an Astro major-version migration; do not use a forced upgrade without validating the Cloudflare adapter and deployed application.

## Accessibility, languages, and offline behavior

Dashboard cards are native links, camera previews are keyboard-accessible buttons, and fullscreen images use native dialogs with Escape and focus restoration. Errors and status changes are announced to assistive technology. Reduced-motion preferences are respected.

Language selection honors `Accept-Language` weights and `q=0`. HTML varies by that header. Dates shown by camera galleries follow the selected language.

The service worker caches only a static offline explanation. It does not cache live sensor responses or camera images. A network failure during navigation shows the offline page rather than stale readings.

Crawler exclusion now lives in `public/robots.txt`, where Astro serves it. HTML and response headers also request no indexing. These directives are privacy preferences, not access control.

## Deployment

The audit changes are local until explicitly released. After checks pass, use the project's established Git/Cloudflare deployment flow. The generated Cloudflare build configuration is under `dist/server/`.
