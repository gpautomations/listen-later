<!-- Source of truth: privacy-policy.html (published at https://quiet-cedar-ulkb.agentpub.io/) -->
# Listen Later: Privacy Policy

Publisher: Growth Process Automation · Last updated: November 21, 2026 · Applies to the Listen Later browser extension, version 0.2.0 and later

**In short:** We don't collect any data. The voice runs on your own computer, and the articles you listen to stay there. The one exception is the optional "Send to my phone" feature, which sends an article only to a server address you set up yourself.

## What Listen Later does

Listen Later reads the article on the web page you're viewing aloud and highlights each word on that page as it's spoken. It uses an open-source text-to-speech model (Kokoro) that runs inside your browser.

## Data we collect

None. Growth Process Automation doesn't operate any server that receives data from the extension. We have no accounts, analytics, tracking, advertising or cookies, and we don't collect, store, sell or share personal information or browsing history.

Our handling of user data complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies), including the Limited Use requirements. Listen Later doesn't use any Google APIs. The only user data it handles, such as the text of the page you're reading, is used solely to provide its read-aloud feature. It isn't sold, used for advertising or to determine creditworthiness, transferred to anyone else (apart from a server you choose yourself with Send to my phone), or read by people.

## What stays on your device

- **Article text.** To read a page aloud, the extension reads that page's text in your browser. The text is processed locally and isn't sent to us or to anyone else.
- **Speech.** Audio is generated on your computer by the voice model, using your graphics card (WebGPU) when available or your processor otherwise. No audio is uploaded.
- **Settings.** Your voice, speed, quality and optional server address are saved locally in your browser's extension storage (`chrome.storage.local`). They aren't synced or sent anywhere by the extension.
- **Voice model cache.** The downloaded model files are cached in your browser so they only download once. You can remove them by uninstalling the extension.

## Model files downloaded from Hugging Face

The first time you press play, the extension downloads the open-source Kokoro voice model and voice files from Hugging Face (`huggingface.co` and its content delivery network, such as `*.hf.co`). These are ordinary file downloads. No article text or personal information is included in them. As with any download, Hugging Face's servers receive your IP address and standard browser request information, under [Hugging Face's privacy policy](https://huggingface.co/privacy).

## Optional: "Send to my phone"

Send to my phone is off until you set it up. If you enter a server address in the extension's Options and allow access to it, pressing the phone button sends that article's title, web address and text to **that address only**. It's meant for your own Listen Later server (for example, a computer at home) that turns articles into episodes in your private podcast feed.

- Nothing is sent unless you press the button.
- It's only ever sent to the address you entered. Neither we nor anyone else receives a copy.
- Whoever runs that server (normally you) controls what happens to the article there.
- You can remove the server address at any time in Options, which also removes the extension's access to it.
- We recommend using a secure (`https://`) address for any server that isn't on your own computer or home network.

## Share links

"Share listen link" copies the original article's web address with `#listen-later` added to the end. Browsers don't send the part after `#` to the website, and we don't host or track these links. When someone who has Listen Later opens one, their extension shows the player.

## Deleting your data

Everything Listen Later keeps is on your own device. Your settings are stored in your browser's local extension storage, and the downloaded voice model is stored in your browser's cache. Uninstalling the extension removes both. You can remove the Send to my phone server address at any time in Options (Remove server). We hold no personal data about you, so there's nothing for us to export or delete. Questions: [scott@gpautomations.com](mailto:scott@gpautomations.com).

## Permissions

- **Access to the pages you read:** so the extension can find the article and highlight words in place. It doesn't read aloud or change anything on a page until you press play, apart from showing its small player.
- **Hugging Face access:** to download the voice model files.
- **Offscreen document and storage:** to run the voice model and remember your settings.
- **Optional access to your server:** requested only when you save a server address for Send to my phone.

## Children

Listen Later isn't directed at children under 13. We don't knowingly collect any personal information from anyone, including children. If you believe a child's data has reached us, contact us at [scott@gpautomations.com](mailto:scott@gpautomations.com) and we'll help remove it.

## Changes

If this policy changes, we'll update this page and the date above. If the extension ever starts collecting data, we'll say so here before it does.

## Contact

Questions about privacy: [scott@gpautomations.com](mailto:scott@gpautomations.com)  
Growth Process Automation

© 2026 Growth Process Automation. Listen Later uses the open-source Kokoro-82M model (Apache-2.0).  
Listen Later is free software under GPL-3.0-or-later. Source: https://github.com/gpautomations/listen-later
