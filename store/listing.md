# Chrome Web Store listing draft: Listen Later (v0.2.0)

Status: DRAFT. Nothing has been submitted or published.

- Upload package (store build, no personal server): `store/listen-later-store-0.2.0.zip` (manifest at the zip root)
- Privacy policy URL: https://quiet-cedar-ulkb.agentpub.io/ (Agent Pub, unlisted, noindex)
- Publisher: Growth Process Automation
- Contact / support email: scott@gpautomations.com
- Source code (GPL-3.0-or-later): https://github.com/gpautomations/listen-later

## Name
Listen Later: read-along for any article

## Short description (max 132 characters)
Hear any article read aloud by a private, on-device voice, with each word highlighted right on the original page.

(113 characters)

## Category
Productivity (alternative: Accessibility)

## Long description
Listen Later reads articles aloud and highlights every word as it's spoken, right on the page you're already reading. The site's own layout, images and links stay exactly where they are.

The voice runs entirely in your browser. Listen Later uses Kokoro, an open-source neural voice, on your own computer (WebGPU when available, otherwise WebAssembly). There's no account, no subscription and no server reading your pages. The only download is the voice model itself, fetched once from Hugging Face and cached.

What you can do:
• Click the toolbar icon (or right-click the page, or press Alt+Shift+L) and then press play. A small player appears in the corner, and the current sentence and word light up as they're read. Nothing runs on a page until you do this. You can also pin a site so the player shows there by itself.
• Click any sentence to jump there.
• Pick a speed from 0.8x to 2x, and choose from seven natural voices (American and British, female and male).
• Choose High quality (the full voice model) or Fast (a smaller download).
• Scroll freely. The page follows the voice until you scroll, then a Follow button brings you back.
• Save episode. One button downloads a single HTML file with the article, word timings and audio inside. Open it anytime, including offline. Put it in a Google Drive or Dropbox folder if you want it on your other devices. Listen Later does not host it.
• Send to my phone (optional). If you run the free, open-source Listen Later server on your own computer, one tap turns the article into an episode in your private podcast feed. You do not need that server to save an episode.

Privacy, in one line: the article text never leaves your computer, except when you choose "Send to my phone", which sends it only to the server address you set. Save episode writes a file on your computer and does not upload it.

Works best on articles, blogs, essays and documentation. English voices only for now.

Listen Later is free software under GPL-3.0-or-later. Source: https://github.com/gpautomations/listen-later

## Single purpose (for the review form)
Read the article on the current page aloud with an on-device voice and highlight each word in place.

## Permission justifications (for the review form)
- No content script on all pages. The player is injected with `activeTab` + `scripting` only after a toolbar click, the "Listen to this page" context menu item, or the Alt+Shift+L command. That removes the install-time "Read and change all your data on all websites" warning.
- activeTab: temporary access to the tab the user just invoked the extension on, so the article can be found and words highlighted.
- scripting: injects the packaged content script and CSS into that tab on demand.
- contextMenus: adds "Listen to this page" to the page menu.
- offscreen: runs the voice model in an offscreen document (MV3 service workers can't use WebGPU).
- storage: remembers voice, speed, quality, the optional server address and sites the user pinned.
- Host access to huggingface.co / hf.co: one-time download of the open-source voice model files.
- Optional host access (`optional_host_permissions`, not granted at install): requested only when the user saves a server address for Send to my phone, or turns on "Always show on this site" for one site. The store build has no default server and no pinned sites.
- Remote code: none. All JavaScript and WebAssembly ship inside the package. Only model weights (data) are downloaded.
- Not uploaded from this branch. Version stays 0.2.0. The package already in Chrome Web Store review is the previous behavior. Do not publish this build as part of that review.

## Assets in this folder
- icon-128.png (128x128 store icon)
- promo-tile-440x280.png (small promo tile)
- screenshots/1-read-along-on-the-original-page.png (1280x800)
- screenshots/2-voices-speed-quality.png (1280x800)
- screenshots/3-send-to-my-phone.png (1280x800)
- screenshots/4-shared-listen-link.png (1280x800) OUTDATED: the share-link button was removed. Reshoot before the next store upload.
Screenshots use the Wikipedia article "Steam engine" (CC BY-SA 4.0), not Notion content. Credit line for the listing if needed: "Article: Wikipedia, CC BY-SA 4.0."

## Privacy practices tab (answers)
- Data collected: none. (Website content is processed only on the device; the user-initiated "Send to my phone" sends it only to a server the user configures, not to the developer.)
- Certify: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.
- Privacy policy URL: https://quiet-cedar-ulkb.agentpub.io/

## Status of earlier pre-submission items
1. Personal default server removed: DONE in the store build (no default server, no host permission for it).
2. Privacy policy hosted publicly: DONE (URL above), contact email set.
3. GPL: DONE. The extension is released under GPL-3.0-or-later with public source at https://github.com/gpautomations/listen-later (tag v0.2.0). eSpeak NG is rebuilt from the vendored, checksummed 1.52.0 source in `third_party/espeak-ng/`; both zips include `COPYING` and `THIRD_PARTY.md`, and the description above carries the source link. Not legal advice.
4. Still open: one-time $5 Chrome Web Store developer registration and account verification for the publisher (Growth Process Automation).
5. Recommended: a support/landing page link (optional field); the GitHub repo URL above can serve as the homepage URL.
