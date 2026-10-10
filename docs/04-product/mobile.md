# Mobile plan

Most delivery orders in Brazil are placed in the iFood app, not on the web.
UPAY3FOOD has to reach the phone without breaking its rules: observe only,
user-initiated, no private APIs, no bots, no personal data.

## Constraints

- Chrome on Android and every browser on iOS run **no extensions**.
- The iFood app cannot be read by another app without an accessibility
  service. That is a privacy and Play-policy risk, so it is ruled out.
- iFood shop and item links (`https://www.ifood.com.br/delivery/...`) open
  the iFood app on phones that have it, and the web page otherwise. **A
  recommendation link already works on mobile.**

## Options

| Option | How data comes in | Effort | Risk | Decision |
|---|---|---|---|---|
| A. Responsive site / PWA | read-only: recommendations, index, methodology | low (site is already responsive) | none | **now** |
| B. Screenshot → on-device OCR → confirm | the user shares a screenshot of the bag or menu; the numbers are read on the phone, confirmed by the user, saved as `manually observed` | medium | low (user-initiated, no automation) | **phase 1** |
| C. Firefox for Android | the same extension: Firefox Android runs WebExtensions; iFood's mobile web needs its own calibration | medium | low | phase 2 |
| D. Safari Web Extension (iOS) | the same code wrapped in an iOS app (App Store, Apple developer account) | high | low | phase 3 |
| E. Accessibility service reading the iFood app | screen reading in the background | — | **high** (privacy, Play policy, ToS) | rejected |

## Phases

1. **Hackathon (now):**
   - `upay3food.com/instalar` and the docs work on phones; on a phone,
     /instalar says the extension is for the computer and points to the
     agent path below;
   - **print → Claude → UPAY3FOOD:** connectors added once on claude.ai also
     appear in the Claude app. The user sends a screenshot of an iFood menu,
     Claude reads the items, and the UPAY3FOOD MCP does the math (per litre,
     per gram, the three layers). The screenshot stays in the user's own
     chat; UPAY3FOOD only receives the item names and prices;
   - recommendations link to the item, which opens the iFood app;
   - the pitch shows the roadmap below.
2. **Phase 1 (2–4 weeks): "Compartilhar print".**
   - On Android, a PWA with the Web Share Target API receives the screenshot
     from the share sheet. On iOS the user uploads it on the page.
   - OCR runs on the device; the image is not uploaded.
   - The user confirms each number before it counts. The same three layers
     and Raio-X then appear on the phone.
   - Provenance is `manually observed`: never mixed silently with live data.
3. **Phase 2:** Firefox for Android build of the extension, with mobile-web
   calibration through the dev bridge.
4. **Phase 3:** Safari Web Extension for iOS, if usage justifies the App
   Store cost.

## Not planned

- Automating the iFood app.
- Reading notifications.
- Any background collection.
