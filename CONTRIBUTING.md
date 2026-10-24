# Contributing to SeekHunt

Thanks for wanting to help! SeekHunt is a small project and every kind of
contribution counts — and the most valuable one doesn't involve code at all.

## The best contribution: play it

Get a few friends together, play a real game, and open a
[playtest report](https://github.com/NouhKhouyi/SeekHunt/issues/new?template=playtest.yml).
What was fun, what dragged, what felt unfair, where GPS or the battery let you
down. That shapes the game more than anything else.

## Running it

You need Node.js 22 or newer.

```bash
npm install
npm run dev        # Worker on :8787 and the web app on :5173
```

Open <http://localhost:5173/?sim> in several tabs. In simulation mode, tapping
the map moves your player, so a whole game can be played from one desk.

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build
```

- **Rules live in `packages/shared`.** The engine is pure and
  server-authoritative; every rule change needs a test in `engine.test.ts`.
- **No player-facing sentences from the server.** It sends message keys with
  parameters; add the text to both languages in `apps/web/src/i18n.ts`.
- **Privacy is a requirement.** The server must never send a phone a position
  it isn't allowed to see. If you touch `viewFor`, say why in the PR.
- **Try it.** Play your change in `?sim` mode, and on a phone if it touches GPS,
  the camera or the layout.

Commits: short, imperative, one change each.

## Ideas

Open an [idea](https://github.com/NouhKhouyi/SeekHunt/issues/new?template=idea.yml).
The roadmap in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md#roadmap-from-competitor-research)
lists what's planned and why.

## License

By contributing you agree that your work is released under the
[MIT License](LICENSE).
