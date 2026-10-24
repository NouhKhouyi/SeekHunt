# Security and privacy

SeekHunt shares real-time locations between people playing in the street, so
security and privacy problems matter more here than in most games.

## Reporting a problem

Please **don't open a public issue**. Use GitHub's
[private vulnerability reporting](https://github.com/NouhKhouyi/SeekHunt/security/advisories/new)
and describe what you found and how to reproduce it. You'll get a reply within
a week.

Especially welcome: any way to see a position you shouldn't, to catch someone
without meeting them, or to keep data longer than the rules below say.

## What the game promises

- **Personalised views.** The server decides what each player may see and sends
  nothing else. Hidden positions never reach the browser.
- **No history.** Only the latest position of each player is kept, and a room is
  deleted after 12 hours without activity.
- **Consent first.** Location isn't requested until a player has read what is
  shared, with whom and for how long.
- **Fair catches.** A catch needs the hider's code and, when both phones know
  where they are, the two must be together. Wrong codes trigger a growing
  cooldown, so codes can't be guessed.
- **SOS.** Any player can reveal themselves to everyone and alert the group.
