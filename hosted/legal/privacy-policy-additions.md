# Listen Later privacy policy: hosted-link additions (draft)

Status: **draft for lawyer review. Not published. Not in force.**

The live policy is still `store/privacy-policy.md` (and `store/privacy-policy.html`). Do not replace it until a lawyer has reviewed this draft. The Chrome Web Store listing must not claim a hosted service until that review, and until the store upload is intentionally updated.

Below, **Original** is the current wording. **Revised** is the proposed wording. Sections with no original are new.

Placeholder abuse address: abuse@example.com. Operator contact remains scott@gpautomations.com.

Last drafted: November 23, 2026.

## In short

### Original

> **In short:** We don't collect any data. The voice runs on your own computer, and the articles you listen to stay there. Listen Later does not run on a page until you turn it on. The one exception that sends an article anywhere is the optional "Send to my phone" feature, which sends it only to a server address you set up yourself. Save episode writes a file on your computer. We never receive that file.

### Revised

> **In short:** The voice runs on your own computer. Listen Later does not run on a page until you turn it on. Save episode writes a file on your computer, and we do not receive that file. Two optional features can send an article somewhere, and only when you press the button: "Send to my phone" sends it only to a server address you set up yourself, and "Save and get link" uploads a private read-along to a Listen Later hosted address you configure. If you never set those addresses, nothing is uploaded.

## Data we collect

### Original

> None. Growth Process Automation doesn't operate any server that receives data from the extension. We have no accounts, analytics, tracking, advertising or cookies, and we don't collect, store, sell or share personal information or browsing history.
>
> Our handling of user data complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies), including the Limited Use requirements. Listen Later doesn't use any Google APIs. The only user data it handles, such as the text of the page you're reading, is used solely to provide its read-aloud feature. It isn't sold, used for advertising or to determine creditworthiness, transferred to anyone else (apart from a server you choose yourself with Send to my phone), or read by people.

### Revised

> Growth Process Automation does not sell data, run advertising, or use the extension for tracking. The extension has no analytics cookies. The voice model still runs on your computer.
>
> If you configure Save and get link, we operate a server that stores the episodes you choose to upload, and a secret key created on that browser so you can list and delete them. That is described under "Hosted private links" below. If you do not configure it, we do not receive those episodes.
>
> Our handling of user data complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies), including the Limited Use requirements. Listen Later doesn't use any Google APIs. The only user data it handles, such as the text of the page you're reading, is used solely to provide its read-aloud feature and, if you ask, a private link to that read-along. It isn't sold, used for advertising or to determine creditworthiness, or transferred to anyone except the hosted service you configure or a server you choose yourself with Send to my phone. People at Growth Process Automation do not read episodes except to act on a report or a takedown.

## What stays on your device

### Original

> - **Saved episodes.** If you press Save episode, Listen Later builds an HTML file on your computer that contains the article text, the spoken audio and the word timings. Your browser downloads that file. We don't receive it. It is uploaded only if you put it in a cloud folder yourself, for example with the Google Drive or Dropbox app on your computer.

### Revised

> - **Saved episodes.** If you press Save episode, Listen Later builds an HTML file on your computer that contains the article text, the spoken audio and the word timings. Your browser downloads that file. We don't receive it. It is uploaded only if you put it in a cloud folder yourself, for example with the Google Drive or Dropbox app on your computer, or if you separately press Save and get link.
> - **Hosted account key.** If you use Save and get link, this browser creates a random secret and stores it in extension storage. It is sent only to the hosted address you configured, as proof that this install may list and delete its own episodes. It is not a password you choose, and it is not sent anywhere else.

## Saved episodes

### Original

> Save episode downloads one HTML file that contains the article text, word timings and audio. Open that file later and it still plays, including offline. We don't host it, and we don't see it. A link inside the file points at the original article so you can get back to the page. The audio and the highlighting script are stored in the file itself.

### Revised

> Save episode downloads one HTML file that contains the article text, word timings and audio. Open that file later and it still plays, including offline. We don't host that file, and we don't see it, unless you also press Save and get link. A link inside the file points at the original article so you can get back to the page. The audio and the highlighting script are stored in the file itself.

## Hosted private links

This section is new. There is no original paragraph.

If you enter a hosted address in Options and press Save and get link, the extension uploads that episode to that address. The upload contains the article text, word timings, the spoken audio, the original page's address, and images from the article when the browser can read them. It is used to show the private read-along page and to play the audio. It is not used for advertising and it is not sold.

The page is not listed in a public directory. The address is a long random id. Anyone you give the link to can open it. Search engines are asked not to index it (`noindex, nofollow`, and a robots file that disallows the whole site). That is a request to crawlers, not a guarantee that nobody will save the link.

We store the upload in object storage so the page can load, including the audio in pieces so a phone can seek. We store a hash of the browser's secret, not the secret itself, so the same browser can list and delete what it uploaded. We do not store a password. Email sign-in is not part of this version, so we do not collect an email address for the hosted link.

The episode page links to the original article and includes a Report a problem link to the configured abuse address. A report email is handled as a takedown request. We keep a short record that an episode id was removed, and an optional reason the operator typed, so the deletion can be audited. We do not add a public report archive.

Hosting provider: Cloudflare (Workers and R2). They process the connection, including IP address and standard request logs, under their own terms. We do not add a separate analytics tool.

You can delete an episode from the extension's options page. You can also ask for deletion at the abuse address if you have lost the browser key. Deleting the extension removes the key from your browser. It does not, by itself, delete episodes already uploaded.

## Deleting your data

### Original

> Everything Listen Later keeps is on your own device. Your settings are stored in your browser's local extension storage, and the downloaded voice model is stored in your browser's cache. Uninstalling the extension removes both. You can remove the Send to my phone server address at any time in Options (Remove server). You can remove an always-show site in Options, which also removes the extension's access to that site. Saved episode files are ordinary files in your downloads folder, or wherever you moved them. Delete them the same way you delete any other file. We hold no personal data about you, so there's nothing for us to export or delete. Questions: [scott@gpautomations.com](mailto:scott@gpautomations.com).

### Revised

> Settings, the voice model cache, and the hosted account key are on your device. Uninstalling the extension removes them. You can remove the Send to my phone server address at any time in Options (Remove server). You can remove a hosted address in Options (Remove address), which hides Save and get link. You can remove an always-show site in Options, which also removes the extension's access to that site. Saved episode files on your computer are ordinary files. Delete them the same way you delete any other file.
>
> Episodes you uploaded with Save and get link are not removed by uninstalling. Delete them in Options first, or write to [scott@gpautomations.com](mailto:scott@gpautomations.com) or the abuse address and include the link. We will delete the episode we can identify. Questions: [scott@gpautomations.com](mailto:scott@gpautomations.com).

## Permissions

### Original

> - **Optional access to your server:** requested only when you save a server address for Send to my phone.

### Revised

> - **Optional access to your server:** requested only when you save a server address for Send to my phone.
> - **Optional access to a hosted address:** requested only when you save a hosted address for Save and get link. The extension asks Chrome for that one origin. It is not granted to every site.

## Changes

### Original

> If this policy changes, we'll update this page and the date above. If the extension ever starts collecting data, we'll say so here before it does.

### Revised

> If this policy changes, we'll update this page and the date above. Save and get link is the feature that stores an episode on a server we operate, and only after you configure the address and press the button. This section will be updated again before that feature is turned on for the public store listing.
