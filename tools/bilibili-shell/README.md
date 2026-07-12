# bilibili redirect shell (deploy once)

`index.html` here is the page uploaded to the trusted zh-CN share path on
bilibili (e.g. `https://www.bilibili.com/toy/Manosaba_WitchfactorTest/index.html`).
It is **not** a mirror of the site — it is a self-contained shell that
immediately redirects to the canonical site, forwarding `?r=<tag>` to the
per-card page `/r/<tag>/` (invalid or missing tag → the zh-CN exam entry).

Why it exists: links pasted into WeChat/QQ carry a domain those apps trust
(bilibili.com), so zh-CN copy-share text and the QR on exported card PNGs
point here (`PUBLIC_SHARE_URL_ZH_CN` in `.env`). The shell then hands off to
the always-fresh canonical site — so bilibili **never needs redeploying for
content releases**. The only event that requires re-uploading this file is a
change of the canonical domain (`SITE` constant + the `<noscript>` URL).

Why a redirect and not an iframe: inside a cross-origin iframe, clipboard
writes and the Web Share API — the share row's core — are blocked or
unreliable in mobile webviews (WeChat/QQ above all), and iOS iframe viewport
handling is buggy; an iframe would also force the canonical site to serve
frame-allowing headers forever. The redirect keeps the trust benefit where it
matters (the pasted/scanned link is bilibili.com) and costs nothing after
hand-off.

Deploy: upload `index.html` as-is to the bilibili path, then set
`PUBLIC_SHARE_URL_ZH_CN` to the full bilibili URL and rebuild the site.
Verify per the soft-launch checklist: the copied zh-CN share link must open
from a WeChat/QQ chat without a distrust interstitial and land on the card.
