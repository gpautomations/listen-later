<!-- Source of truth: privacy-policy.html (published at https://quiet-cedar-ulkb.agentpub.io/) -->
# Listen Later: Privacy Policy

Publisher: Growth Process Automation · Last updated: November 23, 2026 · Applies to the Listen Later browser extension, version 0.2.0 and later

**In short:** We don't collect any data. The voice runs on your own computer, and the articles you listen to stay there. Listen Later does not run on a page until you turn it on. The one exception that sends an article to a server you chose is the optional "Send to my phone" feature. Save episode writes a file on your computer. We never receive that file. If you choose Save to Google Drive, that file is uploaded to your own Google Drive.

## What Listen Later does

When you turn Listen Later on for a page, it reads the article there aloud and highlights each word as it's spoken. It uses an open-source text-to-speech model (Kokoro) that runs inside your browser. It does not read pages you have not turned it on for. If you choose "Always show on this site" for a site, it can show its player on later visits to that site.

## Data we collect

None. Growth Process Automation doesn't operate any server that receives data from the extension. We have no accounts, analytics, tracking, advertising or cookies, and we don't collect, store, sell or share personal information or browsing history.

Our handling of user data complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies), including the Limited Use requirements. Listen Later does not use Google APIs unless you choose Save to Google Drive. That choice is available only in a copy of the extension that has a Google client id. It uploads the saved file to a Listen Later folder in your own Google Drive. Google receives that file under [Google's privacy policy](https://policies.google.com/privacy). We do not. The extension then shows you a link and a QR code for the file. The link is not sent to anyone else, and the file is not made public. The only user data it handles, such as the text of the page you're reading, is used solely to provide its read-aloud feature. It isn't sold, used for advertising or to determine creditworthiness, transferred to anyone else (apart from a server you choose yourself with Send to my phone, or Google Drive when you choose that save), or read by people.

## What stays on your device

- **Article text.** To read a page aloud, the extension reads that page's text in your browser. The text is processed locally and isn't sent to us. It leaves your computer only if you press Send to my phone or Save to Google Drive.
- **Speech.** Audio is generated on your computer by the voice model, using your graphics card (WebGPU) when available or your processor otherwise. No audio is uploaded, except as part of a file you choose to save to your own Google Drive.
- **Settings.** Your voice, speed, quality, optional server address and the sites you asked to always show are saved locally in your browser's extension storage (`chrome.storage.local`). They aren't synced or sent anywhere by the extension.
- **Voice model cache.** The downloaded model files are cached in your browser so they only download once. You can remove them by uninstalling the extension.
- **Saved episodes.** If you press Save episode, Listen Later builds an HTML file on your computer that contains the article text, pictures from the article, the spoken audio and the word timings. Pictures are copied into the file so it still looks like the article when you open it later. Your browser saves that file. We don't receive it. It is uploaded only if you put it in a cloud folder yourself, or if you press Save to Google Drive.

## Model files downloaded from Hugging Face

The first time you press play, the extension downloads the open-source Kokoro voice model and voice files from Hugging Face (`huggingface.co` and its content delivery network, such as `*.hf.co`). These are ordinary file downloads. No article text or personal information is included in them. As with any download, Hugging Face's servers receive your IP address and standard browser request information, under [Hugging Face's privacy policy](https://huggingface.co/privacy).

## Optional: "Send to my phone"

Send to my phone is off until you set it up. If you enter a server address in the extension's Options and allow access to it, pressing the phone button sends that article's title, web address and text to **that address only**. It's meant for your own Listen Later server (for example, a computer at home) that turns articles into episodes in your private podcast feed.

- Nothing is sent unless you press the button.
- It's only ever sent to the address you entered. Neither we nor anyone else receives a copy.
- Whoever runs that server (normally you) controls what happens to the article there.
- You can remove the server address at any time in Options, which also removes the extension's access to it.
- We recommend using a secure (`https://`) address for any server that isn't on your own computer or home network.

## Saved episodes

Save episode writes one HTML file that contains the article text, pictures from the article, word timings and audio. Open that file later and it still plays, including offline. We don't host it, and we don't see it. A link inside the file points at the original article so you can get back to the page. The pictures, the audio and the highlighting script are stored in the file itself. A picture that the page will not let the browser read (a common block on images hosted elsewhere) is left out, and the file still saves.

## Optional: Save to Google Drive

Save to Google Drive is hidden until a Google client id is added to this copy of the extension. If you then press it, Chrome asks you to connect your Google account. The extension creates a folder named Listen Later in your Drive, if you do not already have one it created, and uploads the HTML file there. The permission is `drive.file`: the extension can see and change only files it created, not the rest of your Drive. We do not receive the file or your Google account. After the upload, the extension shows the file's link and a QR code drawn on your computer, so you can open the file on your phone. The phone needs to be signed in to the same Google account. The file is not shared with anyone else. Google Drive's own preview, and the iPhone Files preview, do not run the page, so the audio and highlighting start only after you download the file and open it in a browser.

## Deleting your data

Everything Listen Later keeps is on your own device. Your settings are stored in your browser's local extension storage, and the downloaded voice model is stored in your browser's cache. Uninstalling the extension removes both. You can remove the Send to my phone server address at any time in Options (Remove server). You can remove an always-show site in Options, which also removes the extension's access to that site. Saved episode files are ordinary files in your downloads folder, or wherever you moved them. Delete them the same way you delete any other file. We hold no personal data about you, so there's nothing for us to export or delete. Questions: [scott@gpautomations.com](mailto:scott@gpautomations.com).

## Permissions

- **The page you turn on:** Listen Later does not read or change pages by itself. It runs only after you click the toolbar icon, choose "Listen to this page" in the right-click menu, or use the keyboard shortcut. It can then find the article and highlight words on that page.
- **A site you pin:** If you turn on "Always show on this site", Chrome asks you to allow that site. Only then can the player appear there on later visits. You can remove it in Options.
- **Hugging Face access:** to download the voice model files.
- **Offscreen document and storage:** to run the voice model and remember your settings, including sites you pin.
- **Downloads:** so Save episode can use Chrome's save dialog when the page cannot show its own folder picker.
- **Optional Google account:** requested only if you press Save to Google Drive. The extension can then create files in your Drive. It does not read files it did not create.
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
