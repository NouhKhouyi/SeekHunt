<p align="center">
  <img src="apps/web/public/icon.svg" width="72" alt="">
</p>

<h1 align="center">SeekHunt</h1>

<p align="center">
  <b>Escóndete. La zona se cierra.</b><br>
  Escondite en la vida real desde el móvil: un cazador, una zona que encoge cada
  pocos minutos y un único superviviente.
</p>

<p align="center">
  <a href="https://seekhunt.nouhk.workers.dev"><img src="https://img.shields.io/badge/▶_jugar_ya-gratis,_sin_instalar-ff5714?style=for-the-badge" alt="Jugar ya"></a>
</p>

<p align="center">
  <a href="https://github.com/NouhKhouyi/SeekHunt/actions/workflows/ci.yml"><img src="https://github.com/NouhKhouyi/SeekHunt/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licencia-MIT-121417" alt="Licencia MIT"></a>
  <a href="README.md"><img src="https://img.shields.io/badge/🇬🇧-read_in_English-121417" alt="Read in English"></a>
</p>

<p align="center">
  <img src="docs/assets/gameplay.gif" width="860" alt="Tres móviles jugando una partida de SeekHunt: el cazador y dos escondidos">
  <br>
  <sub>Tres móviles en la misma partida, acelerado. Izquierda: el cazador. Centro y derecha: los escondidos.</sub>
</p>

## 🏃 Cómo se juega

1. **Crea una sala.** Alguien crea la partida, coloca la zona sobre vuestro
   barrio y comparte el enlace. Todos entran desde el navegador del móvil: sin
   tiendas de apps ni cuentas.
2. **Escóndete.** Los escondidos tienen ventaja mientras el cazador espera.
   Tres, dos, uno… *sale el cazador*.
3. **Quédate dentro.** Cada pocos minutos la zona se cierra, como en un battle
   royale. El siguiente círculo siempre se ve en el mapa. Si sales, quedas al
   descubierto: vuelve antes de que acabe la cuenta atrás.
4. **Que te pillen de verdad.** El cazador tiene que tocarte y escanear el QR de
   tu pantalla. El GPS solo nunca decide una captura.
5. **Gana el último en pie.** Después, todos ven el resumen: quién pilló a quién,
   cuándo, y una imagen del resultado para presumir.

## ✨ Qué trae

| | |
|---|---|
| 🎯 **Una zona que se cierra** | Cada círculo cabe en el anterior y sale de una semilla, así que todos los móviles ven exactamente la misma zona. |
| 📡 **Radar** | Cada pocos minutos el cazador ve un círculo aproximado de cada escondido, y los escondidos ven a los cazadores. |
| 🔳 **Capturas con QR** | Tocar, escanear, pillado. En Android y en iPhone, o escribiendo las 4 cifras. |
| 🎬 **Momentos grandes** | 3-2-1 antes de la salida, *¡A CAZAR!* y un aviso cada vez que la zona se cierra. |
| 🧭 **Vuelta a la zona** | Si sales, una flecha y la distancia te llevan de vuelta. |
| ⏸️ **Pausa del anfitrión** | Congela relojes, zona y radar. Al reanudar, la partida sigue justo donde estaba. |
| 🏆 **Resumen e imagen** | Duración, capturas, la cronología de la partida y una imagen con las zonas reales para compartir. |
| 🧟 **Modo infección** | Los pillados se unen a la caza. Ideal para grupos grandes. |
| 🏢 **Modo edificio** | Cada jugador indica su planta y el radar la muestra. |
| 🆘 **SOS** | Un toque te hace visible para todos con un aviso. |
| 🌍 **Español e inglés** | Cada móvil muestra la partida en su idioma, incluso en la misma sala. |

## 🛡️ Justo y seguro

- **El servidor es el árbitro.** Cada móvil solo recibe lo que su jugador puede
  ver, así que las posiciones ocultas no se pueden sacar del navegador.
- **Hay que encontrarse.** Una captura exige el código del escondido y, si los
  dos móviles saben dónde están, estar a unos 80 m. Apagar tu GPS no se salta
  la comprobación.
- **No sirve adivinar códigos.** Tras tres fallos, una espera que se duplica:
  probar los 10 000 códigos llevaría días.
- **A pie.** Por encima de 25 km/h no se puede pillar.
- **Privacidad.** La ubicación solo se pide tras una pantalla de consentimiento,
  no se guarda historial y las salas se borran a las 12 h.

Todas las reglas, el equilibrio y el porqué están en el
[documento de diseño](docs/GAME_DESIGN.es.md).

## 🚀 Ejecutarlo

Necesitas Node.js 22 o superior.

```bash
git clone https://github.com/NouhKhouyi/SeekHunt
cd SeekHunt
npm install
npm run dev        # worker en :8787 y web en :5173
```

- **Desde casa:** abre <http://localhost:5173/?sim> en varias pestañas; tocar el
  mapa mueve a tu jugador.
- **Con móviles en tu wifi:** `npm run dev:phone` y abre
  `https://<ip-de-tu-pc>:5173` (acepta el aviso del certificado). Los
  navegadores solo dan GPS y cámara a páginas `https`.
- **Tu propio despliegue** en Cloudflare: `npx wrangler login` una vez y
  `npm run deploy`.

## 🤝 Contribuir

La mejor contribución es jugar con amigos y contarlo en un
[informe de partida](https://github.com/NouhKhouyi/SeekHunt/issues/new?template=playtest.yml).
Para código, mira [CONTRIBUTING.md](CONTRIBUTING.md). Si encuentras la forma de
ver a alguien que no deberías, avisa en privado: [SECURITY.md](SECURITY.md).

## 📄 Licencia

[MIT](LICENSE). Datos del mapa © colaboradores de
[OpenStreetMap](https://www.openstreetmap.org/copyright), teselas de
[OpenFreeMap](https://openfreemap.org).

<p align="center"><sub>Hecho en Valencia por <a href="https://github.com/NouhKhouyi">Nouh Khouyi</a>. Sal a la calle. 🧡</sub></p>
