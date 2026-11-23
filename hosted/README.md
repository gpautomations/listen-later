# Listen Later hosted links

A small Cloudflare Worker and an R2 bucket. A person who already uses Listen Later can press **Save and get link** and get a private URL. That URL opens the read-along on another device, including a phone: the article text, pictures that could be copied, the spoken audio, word highlighting, and tap-to-seek.

This is a personal-use reading tool, in the same family as saving an article to Pocket, Instapaper, or Speechify. It is not a public republishing site. There is no catalog, no search, and no page that lists someone else's episodes.

The extension still builds the episode on the device. The worker only stores the pieces and serves them back to whoever has the link.

## What gets uploaded

The extension sends multipart form data:

| Part | Required | What it is |
|---|---|---|
| `manifest` | yes | JSON. Title, original article URL, voice label, duration, paragraphs of `{text, start, end}`, and image placements. |
| `audio` | yes | Opus in WebM when the browser can encode it, otherwise 16-bit WAV. |
| `image` | no | Repeatable. JPEG, PNG, GIF, or WebP. The manifest names each file. |

The self-contained HTML file from **Save episode** is the same article, timings, and audio packed for offline use. This upload is that bundle split apart so a phone can seek with HTTP Range requests. The worker does not serve uploaded HTML. User HTML would run on this origin. The page you open is rendered here, with the text escaped.

## API

All responses send `X-Robots-Tag: noindex, nofollow`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/episodes` | install secret | Upload one episode. Returns `{id, url, title, bytes, durationSec}`. |
| `GET` | `/api/episodes` | install secret | List only that install's episodes. |
| `DELETE` | `/api/episodes/:id` | install secret | Delete one episode you uploaded. |
| `GET` | `/e/:id` | the link itself | Read-along page. |
| `GET` | `/e/:id/audio` | the link itself | Audio with `Accept-Ranges: bytes`. |
| `GET` | `/e/:id/i/:name` | the link itself | One image from that episode. |
| `GET` | `/api/health` | none | `{ok: true}`. Does not list anything. |
| `GET` | `/robots.txt` | none | `Disallow: /` |
| `POST` | `/api/takedown` | `ADMIN_TOKEN` | Delete an episode by id. Disabled when the token is unset. |

Episode ids are 128 bits, encoded as 22 unguessable URL-safe characters. Guessing one is not a practical attack. Anyone who has a link can open it, so treat the link like a private document.

Quotas (override with Worker vars):

- 40 MB per episode (`MAX_EPISODE_BYTES`)
- 25 episodes per install (`MAX_EPISODES`)
- 250 MB stored per install (`MAX_ACCOUNT_BYTES`)
- 8 uploads per hour (`UPLOADS_PER_HOUR`)
- 20 images, 1.5 MB each

## Identity v1

The extension creates a random 256-bit secret the first time it uploads and stores it in `chrome.storage.local` under `hostedAccountSecret`. Uploads send `Authorization: Bearer <secret>`. The worker hashes the secret with SHA-256 and uses the hash as the account id. The raw secret is not stored.

There is no password and no email. Uninstalling the extension deletes the secret. The links keep working until the episodes are deleted. Delete them first if you want the links to stop. A lost secret cannot list or delete episodes. The takedown endpoint can still remove one by id.

### Email magic link, later, not built

The account record already has empty `email` and `emailVerifiedAt` fields. A later version can add sign-in without throwing away episodes:

1. The signed-in install calls `POST /api/auth/email` with its existing bearer secret and an email address.
2. The worker stores a pending address and a one-time token hash that expires in 15 minutes. It would email `https://<host>/auth/magic?token=...`. Sending mail is not implemented.
3. Opening that link marks the email verified and sets an HttpOnly, Secure, SameSite cookie. The cookie id is random. Only its hash would be stored.
4. A second device, after the magic link, calls `POST /api/auth/install` to attach a new install secret to the same account. Both devices then list the same episodes.
5. The episode ids do not change, so old links keep working.

Until that exists, each browser install is its own account.

## Copyright and privacy safeguards

- `X-Robots-Tag: noindex, nofollow` and `<meta name="robots" content="noindex, nofollow">` on pages.
- `robots.txt` disallows every path. There is no sitemap. `/sitemap.xml` is a 404.
- The home page is a short explanation. It does not list episodes.
- One install cannot list or delete another install's episodes.
- Every episode page has a prominent link to the original article, with `rel="noreferrer"` so the episode URL is not sent as a referrer.
- **Report a problem** is a mailto link. The address is the `ABUSE_EMAIL` var. The committed placeholder is `abuse@example.com`. Change it before anyone relies on it.
- Audio and images send `Cross-Origin-Resource-Policy: same-origin`, so another website cannot embed the file.
- Pages send `X-Frame-Options: DENY` and a Content-Security-Policy that allows only this origin's script and style.
- `POST /api/takedown` with `Authorization: Bearer $ADMIN_TOKEN` and `{"id":"...","reason":"..."}` deletes the episode and writes `takedowns/<id>.json`. Set `ADMIN_TOKEN` as a Worker secret, never in git.

```bash
ADMIN_TOKEN=... HOSTED_BASE_URL=https://listen-later-hosted-staging.scott-408.workers.dev \
  node hosted/scripts/takedown.mjs <episode-id> "reason"
```

Draft terms and the privacy additions are in `hosted/legal/`. They are not in force. A lawyer should review them, and a DMCA designated agent should be registered, before anyone is charged.

## Local run

```bash
cd hosted
npx wrangler dev --local
```

`wrangler dev --local` uses Miniflare and a simulated R2 bucket. It does not need a deploy token.

```bash
node --test hosted/test/api.test.mjs
```

from the repository root runs the same worker against an in-memory bucket.

## Staging deploy

Only with `CLOUDFLARE_DEPLOY_TOKEN`. The generic `CLOUDFLARE_API_TOKEN` cannot publish Workers. Do not deploy production and do not attach a custom domain from this config.

```bash
cd hosted
npx wrangler r2 bucket create listen-later-staging
printf '%s' "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

Worker name: `listen-later-hosted-staging`. Bucket: `listen-later-staging`. Account: `4080369ab1011cfa56dbf9d5b96c885d`. Expected host: `https://listen-later-hosted-staging.scott-408.workers.dev`.

Set `ABUSE_EMAIL` to a mailbox you actually read before sharing links.

## Extension

In the extension options, **Save and get link** stays hidden until a hosted address is saved. Saving asks Chrome for host permission to that origin only. The manifest does not grant the origin up front. `optional_host_permissions` already allows a later grant.

A personal build can pre-fill the address without granting permission:

```bash
HOSTED_BASE_URL=https://listen-later-hosted-staging.scott-408.workers.dev npm run build
```

The store build ignores `HOSTED_BASE_URL`.

## Phone page

The page is one column, uses the safe-area inset, and keeps the audio bar fixed to the bottom. The audio element is `playsinline` with native controls, so iOS can show it on the lock screen. The Media Session API handles play, pause, skip, and seek. The last position is stored in `localStorage` on that phone. Opus is muxed as WebM because Safari's Ogg Opus timeline is wrong and would break word highlighting. WAV still plays if the encoder is unavailable.

Cost notes: `hosted/COST.md`.
