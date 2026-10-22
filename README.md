# SeekHunt

Escondite en la vida real con una zona que se cierra. Una persona busca, el resto se esconde, y la zona se reduce cada X minutos hasta que queda un superviviente.

Las reglas y mecánicas están en [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

## Stack

| Parte | Tecnología |
|---|---|
| Cliente | React 19, Vite y TypeScript. Es una PWA instalable desde el móvil. |
| Mapa | MapLibre GL con tiles de OpenFreeMap (gratis, sin API key). |
| Tiempo real | Cloudflare Workers y **Durable Objects**: una instancia por sala, con WebSockets en hibernación y alarmas como reloj del juego. |
| Reglas | `packages/shared`: motor de juego puro, compartido por cliente y servidor y con tests. |

```
apps/web        cliente PWA
apps/server     Worker + Durable Object GameRoom (estado autoritativo)
packages/shared motor de juego, zonas, geometría, protocolo
scripts/        smoke test de punta a punta
```

## Desarrollo

Requisito: Node 22 o superior.

```bash
npm install
npm run dev        # worker en :8787 y web en :5173 (con proxy de /api y /ws)
npm test           # tests del motor
npm run typecheck
node scripts/smoke.mjs        # partida completa por WebSocket contra el servidor de desarrollo
node scripts/a11y.mjs         # auditoría de accesibilidad (axe) de todas las pantallas, claro y oscuro
node scripts/qr-roundtrip.mjs # comprueba que el escáner lee el QR de captura (camino zxing-wasm, como iPhone)
```

Los dos últimos usan el Microsoft Edge instalado mediante Playwright.

**Lighthouse (móvil):** `npm run build`, luego `npx vite preview` en `apps/web` y por último:

```bash
npx lighthouse http://localhost:4173 --chrome-path="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --form-factor=mobile --view
```

**Probar sin salir de casa:** abre `http://localhost:5173/?sim` en varias pestañas. En modo simulación, tocar el mapa mueve a tu jugador.

**Probar con el móvil en la misma red:** los navegadores solo dan acceso al GPS en páginas `https`. Abrir `http://192.168…` no funciona.
1. Ejecuta `npm run dev:phone`, que sirve la web por HTTPS con un certificado autofirmado.
2. Abre `https://<ip-de-tu-pc>:5173` en el móvil y acepta el aviso del certificado (en iPhone: *Mostrar detalles → Visitar sitio web*).

También puedes usar `npx cloudflared tunnel --url http://localhost:5173` o desplegar.

## Despliegue

```bash
npx wrangler login
npm run build
npm run deploy -w @seekhunt/server
```

Para servir la web desde el propio Worker, añade a `apps/server/wrangler.jsonc`:

```jsonc
"assets": { "directory": "../web/dist", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*", "/ws/*"] }
```
