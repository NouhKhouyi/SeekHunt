# SeekHunt: game design

*[Leer en español](GAME_DESIGN.es.md)*

Real-life hide and seek, or tag, with a play zone that keeps closing in, battle-royale style.

## The game loop

1. **Lobby.** The host creates a room (a 5-letter code), shares the link and
   sets the zone (centre and radius) on the map. Whoever creates the room seeks
   by default; the host can swap roles.
2. **Hiding** (`hideSeconds`). The hiders get a head start while the seeker
   waits at the start. The last three seconds count down on every screen.
3. **Seeking.** The seeker is released, and the zone closes `shrinkCount`
   times, once every `shrinkIntervalSeconds`. Each shrink animates over
   `shrinkDurationSeconds`.
   - The **next zone** is always on the map as a dashed circle, so players can
     plan their route.
   - Every new zone fits entirely inside the previous one. Its centre is random
     but comes from a seed, so the server and every phone compute the same
     circles.
4. **The end.**
   - If the seekers catch everyone, the seekers win.
   - With `lastSurvivorWins`, the last hider standing wins.
   - If time runs out (the last shrink plus `finalHoldSeconds`), every survivor
     wins.
   - Everyone gets a recap: how long it lasted, who caught whom and when, and a
     result card to share.

## Catching someone

GPS alone can't decide a catch: it is off by 5–20 m, and more between
buildings. So a catch combines three checks:

1. **Real contact.** The seeker tags the hider. The group keeps this honest,
   like playground tag.
2. **The hider's QR.** The hider's screen shows a QR code containing
   `SEEKHUNT:<room>:<code>`, and the seeker scans it in the app.
   - Android uses the native `BarcodeDetector`.
   - iPhone uses zxing-wasm, served from our own origin.
   - A QR from another game is rejected.
   - If the camera fails, the seeker can type the 4 digits shown under the QR.
3. **The server's check.**
   - If the hider's position is recent (under 30 s), the seeker's must be too.
     Turning your own GPS off doesn't skip the check.
   - When both are recent, the phones must be within 80 m of each other, plus
     each GPS's own error. Sending your code over WhatsApp doesn't work.
   - A seeker moving faster than 25 km/h can't catch.
   - **Guessing codes doesn't work either.** After three wrong codes in a row,
     the seeker has to wait 30 s, then 60 s, 120 s and so on, up to 5 minutes.
     Trying all 10,000 codes would take days.

If nothing else works, the hider taps **"I've been caught"**.

## Host pause

The host can pause at any moment during hiding or seeking. Clocks, the zone,
the radar and the out-of-zone countdowns all freeze, and nobody can be caught.
On resume, every timer is shifted by the length of the pause, so the game
carries on exactly where it stopped. It is for traffic lights, a friend's
untied shoe, or anything that matters more than the game.

## Radar precision and buildings

**What can be tuned:**
- Radar precision goes from "Exact" to ±300 m.
- On "Exact", the circle is only the error the GPS itself reports. Nothing is
  more precise than that: a phone is off by about 5 m under open sky, 10–20 m
  between buildings and 30–100 m indoors.

**Floors.** A website can't reliably tell which floor someone is on:
- GPS altitude is less accurate than the horizontal position, and indoors it
  rarely arrives at all.
- The barometer, which would solve it, isn't available to websites.

**Building mode (`buildingMode`).**
- Each player sets their floor with a picker (−5 to 200), and the radar shows
  it next to their name: "Ana, floor 3".
- It is an honour rule, like tagging.
- When both phones measure altitude to ±10 m or better, the radar adds the
  difference ("9 m above") as a cross-check.
- If the game is ever wrapped as a native app (Capacitor), the barometer could
  detect floors automatically.

## Languages

The interface is in English and Spanish, picked automatically from the phone's
language and switchable with the EN/ES toggle. The server never sends
sentences: it sends message keys with parameters (`ev.caughtBy {by, name}`),
and each phone shows them in its own language, so players in the same game can
each read the alerts in theirs. The strings live in `apps/web/src/i18n.ts`.

## Balancing mechanics

| Mechanic | Why it exists |
|---|---|
| **Warning 30 s before each shrink** | A sound and a vibration, so nobody is caught outside by accident. |
| **Big moments** | A countdown before the release, a full-screen "The seeker is out!", and a banner every time the zone starts to close. |
| **Out of zone** | A hider outside the zone is **revealed** to the seeker and has `outOfZoneGraceSeconds` to get back in; an arrow and the distance point the way. Otherwise they are eliminated. |
| **Radar** every `pingIntervalSeconds` | The seeker sees a rough circle (±`pingFuzzMeters`) for each hider, and the hiders see the seekers' exact position, so neither side plays blind. Fresh circles pulse like sonar. |
| **Lost signal** | Anyone who stops sending their location for `staleLocationSeconds` is shown to the seeker at their last known position, so switching GPS off gains nothing. |
| **Infection mode** (`caughtBecomeSeekers`) | Caught players become seekers. Great for big groups. |
| **Impossible jumps** | Positions implying more than 60 m/s are discarded: a light defence against fake GPS. |
| **Team balance tip** | In groups of 6 or more, the lobby suggests 1 seeker for every 4–6 hiders. |

## Safety and privacy (requirements, not extras)

- Zones should avoid big roads, railways, water and private property. The home
  screen says so.
- Location is only shared while a game is open, and a room is deleted after 12
  hours without activity.
- Every player gets a **personalised view**: the server never sends a phone a
  position it isn't allowed to see, so it can't be pulled out of the browser's
  developer tools either.
- **Consent before asking for location.** The first time someone enters a
  room, the app explains:
  - what is shared, with whom and when;
  - that no history is kept and the room is deleted after 12 hours;
  - that players must be 14 or older, or have a guardian's permission;
  - the street rules.

  GPS isn't switched on until they agree. This follows the GDPR and Spain's
  LOPDGDD; Spain's data protection authority has fined LaLiga for switching a
  sensor on without telling users.
- **SOS.** Any player can ask for help: everyone gets an alert with sound and
  vibration and sees their exact position until they tap "I'm OK". The app
  reminds them to call 112 in an emergency.
- **On foot only.** Above 25 km/h the app warns the player and refuses catches.
- **Host pause** stops everything at once.

## Roadmap (from competitor research)

Competitors (Gottcha, Zone Hunt, Manhunt, Hunting Zone) get complaints mostly
about **battery, disconnections and lag**. What works for them is
**information you earn or spend** and **abilities with cooldowns**.

| Priority | Idea |
|---|---|
| High | Automatic Jet Lag–style questions answered by the server from GPS, with no effort from the hider: "Are you within 500 m?", "Are you closer than me to point X?" |
| Medium | Abilities with charges: decoy (a fake radar circle) and silence (skip one radar) for hiders; extra ping and a hot/cold meter for seekers. |
| Medium | Comeback mechanics: more frequent radar when few hiders are left, and slower final phases (the PUBG lesson). |
| Low | A route replay for each player in the recap, kept only on the phone and deleted on leaving. |
| Low | Polygon zones and drawable no-go areas (railways, motorways, rivers). |
| Low | A native app with Capacitor, for location with the screen locked. |

## The key technical limit: GPS with the screen off

On iOS a website or PWA **gets no location while the screen is locked**, and
on Android it is unreliable too. Version 1 deals with it like this:

- it keeps the screen on with the Wake Lock API;
- the interface reminds players to keep the screen on;
- a player whose position goes stale is revealed.

If that proves to be a problem in practice, the next step is wrapping the app
with **Capacitor** and a background location plugin, reusing all the web code.
