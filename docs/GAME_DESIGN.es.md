# SeekHunt: diseño del juego

*[Read in English](GAME_DESIGN.md)*

Escondite / pilla-pilla en la vida real con una zona que se va cerrando, al estilo battle royale.

## Bucle de juego

1. **Lobby**: el anfitrión crea una sala (código de 5 letras), comparte el enlace y dibuja la zona (centro y radio) en el mapa. Asigna roles: por defecto, quien crea es el cazador.
2. **Escondite** (`hideSeconds`): los escondidos tienen ventaja y el cazador espera en el punto de salida.
3. **Búsqueda**: la zona se cierra `shrinkCount` veces, una cada `shrinkIntervalSeconds`. Cada cierre se anima durante `shrinkDurationSeconds`.
   - La **próxima zona** se ve siempre en el mapa (círculo blanco discontinuo), así que se puede planificar la ruta.
   - Cada nueva zona cabe entera dentro de la anterior. El centro es aleatorio y sale de una semilla, así que el servidor y los clientes calculan lo mismo.
4. **Fin**:
   - Si el cazador pilla a todos, ganan los cazadores.
   - Con `lastSurvivorWins`, gana el último escondido que quede.
   - Si se acaba el tiempo (último cierre + `finalHoldSeconds`), ganan todos los supervivientes.
   - Todos ven un resumen: duración, quién pilló a quién y cuándo, y una imagen del resultado para compartir.

## Cómo se pilla a alguien

Solo con el GPS no se puede decidir una captura: falla entre 5 y 20 m, y más entre edificios. Por eso la captura combina tres comprobaciones:

1. **Contacto real.** El cazador toca al escondido. Esto lo valida el grupo, como en el pilla-pilla de siempre.
2. **QR del escondido.** El escondido lleva en la pantalla un QR con `SEEKHUNT:<sala>:<código>`, y el cazador lo escanea desde la app.
   - En Android se usa el lector nativo (BarcodeDetector).
   - En iPhone se usa zxing-wasm, servido desde nuestro propio servidor.
   - Si el QR es de otra partida, se rechaza.
   - Si la cámara falla, el cazador puede escribir las 4 cifras que aparecen debajo del QR.
3. **Comprobación del servidor.**
   - Si la posición del escondido es reciente (menos de 30 s), la del cazador también tiene que serlo: apagar tu GPS no se salta la comprobación.
   - Con las dos recientes, los móviles tienen que estar a menos de 80 m, más la precisión de cada GPS. Así no sirve pasarse el código por WhatsApp.
   - Se rechaza la captura si el cazador va a más de 25 km/h.
   - **Tampoco sirve adivinar códigos.** Tras tres códigos incorrectos seguidos, el cazador espera 30 s, luego 60 s, 120 s… hasta 5 minutos. Probar los 10 000 códigos llevaría días.

Si nada de esto funciona, el escondido pulsa **"Me han pillado"**.

## Pausa del anfitrión

El anfitrión puede pausar en cualquier momento del escondite o la búsqueda. Se congelan relojes, zona, radar y cuentas atrás de fuera de zona, y nadie puede ser pillado. Al reanudar, todos los tiempos se desplazan lo que duró la pausa, así que la partida sigue exactamente donde se quedó.

## Precisión del radar y edificios

**Lo que se puede afinar:**
- La precisión del radar va de "Exacta" a ±300 m.
- En "Exacta" el círculo es solo el error que el propio GPS declara. No se puede ir más allá: un móvil falla unos 5 m a cielo abierto, entre 10 y 20 m entre edificios y entre 30 y 100 m en interior.

**Plantas.** Una web no puede saber de forma fiable en qué planta está alguien:
- La altitud del GPS tiene más error que la posición horizontal, y dentro de un edificio casi nunca llega.
- El barómetro, que sí lo resolvería, no está disponible para las webs.

**Modo edificio (`buildingMode`).**
- Cada jugador indica su planta con un selector (−5 a 200) y el radar la muestra junto al nombre: "Ana, planta 3".
- Es una regla de honor, igual que tocar para pillar.
- Si los dos móviles miden la altitud con un error de ±10 m o menos, el radar añade la diferencia ("9 m más arriba") como comprobación.
- Si en algún momento se empaqueta como app nativa (Capacitor), el barómetro permitiría detectar las plantas solo.

## Idiomas

La interfaz está en español e inglés, y se elige automáticamente según el idioma del móvil (se puede cambiar con el selector ES/EN). El servidor nunca envía frases: envía claves con parámetros (`ev.caughtBy {by, name}`), y cada móvil las muestra en su idioma. Así, en una misma partida cada jugador ve los avisos en el suyo. Los textos están en `apps/web/src/i18n.ts`.

## Mecánicas para equilibrar

| Mecánica | Por qué existe |
|---|---|
| **Aviso 30 s antes de cada cierre** | Suena y vibra para que nadie se quede fuera por despiste. |
| **Fuera de zona** | Quien sale de la zona queda **revelado** al cazador y tiene `outOfZoneGraceSeconds` para volver. Si no vuelve, queda eliminado. |
| **Radar** cada `pingIntervalSeconds` | El cazador ve un círculo aproximado (±`pingFuzzMeters`) de cada escondido, y los escondidos ven la posición exacta del cazador. Así ninguno de los dos bandos va a ciegas. |
| **Señal perdida** | A quien deja de enviar ubicación durante `staleLocationSeconds`, el cazador lo ve en su última posición conocida. Así nadie gana nada apagando el GPS. |
| **Modo infección** (`caughtBecomeSeekers`) | Los pillados pasan a ser cazadores. Funciona bien en grupos grandes. |
| **Momentos grandes** | Cuenta atrás antes de la salida, "¡Sale el cazador!" a pantalla completa y un aviso cada vez que la zona empieza a cerrarse. |
| **Vuelta a la zona** | Quien sale ve una flecha y la distancia hasta el borde. |
| **Equilibrio de equipos** | En grupos de 6 o más, la sala sugiere 1 cazador por cada 4–6 escondidos. |
| **Saltos imposibles** | Se descartan las posiciones que implican más de 60 m/s. Es un antitrampas ligero contra GPS falso. |

## Seguridad y privacidad (requisitos, no extras)

- Las zonas se eligen sin carreteras grandes, vías de tren, agua ni propiedades privadas. La pantalla de inicio lo recuerda.
- La ubicación solo se comparte mientras hay una partida abierta, y la sala se borra tras 12 h sin actividad.
- Cada jugador recibe una **vista personalizada**: el servidor nunca envía a un cliente posiciones que no debe ver, así que tampoco se pueden sacar del inspector del navegador.
- **Consentimiento antes de pedir la ubicación.** Al entrar en una sala por primera vez se explica:
  - qué se comparte, con quién y cuándo;
  - que no se guarda historial y que la sala se borra a las 12 h;
  - que hay que tener 14 años o más, o permiso de un tutor;
  - las normas de la calle.

  El GPS no se activa hasta aceptar. Esto sigue el RGPD y la LOPDGDD; la AEPD ya sancionó a LaLiga por no informar al activar el sensor.
- **SOS.** Cualquier jugador puede pedir ayuda: todos reciben un aviso con sonido y vibración y ven su posición exacta hasta que pulse "Estoy bien". La app recuerda que en una emergencia hay que llamar al 112.
- **Se juega a pie.** Por encima de 25 km/h la app avisa y no deja pillar.
- **Pausa del anfitrión**: lo detiene todo a la vez.
- Pendiente: un punto de encuentro al terminar.

## Hoja de ruta (según la investigación de la competencia)

Los rivales (Gottcha, Zone Hunt, Manhunt, Hunting Zone) reciben quejas sobre todo por **batería, desconexiones y lag**. Lo que les funciona es la **información que se gana o se gasta** y las **habilidades con cooldown**.

| Prioridad | Idea |
|---|---|
| Alta | Preguntas automáticas al estilo Jet Lag que responde el servidor con el GPS, sin que el escondido haga nada: "¿Estás a menos de 500 m?", "¿Más cerca que yo del punto X?" |
| Media | Habilidades con cargas: señuelo (radar falso), silencio (te saltas un radar) para el escondido; ping extra y termómetro para el cazador. |
| Media | Remontada: radar más frecuente cuando quedan pocos escondidos, y fases finales más lentas (la lección de PUBG). |
| Baja | Resumen final con el recorrido de cada jugador, solo en local y borrado al salir. |
| Baja | Zonas con forma de polígono y zonas prohibidas dibujables (vías, autovías, ríos). |
| Baja | App nativa con Capacitor, para tener ubicación con la pantalla bloqueada. |

## Limitación técnica clave: GPS con la pantalla apagada

En iOS, una web/PWA **no recibe ubicación con la pantalla bloqueada**, y en Android también es poco fiable. La v1 lo resuelve así:
- usa Wake Lock para mantener la pantalla encendida;
- avisa en la interfaz de que hay que mantener la pantalla encendida;
- revela al jugador si su posición se queda antigua.

Si al probarlo resulta un problema, el siguiente paso es empaquetarla con **Capacitor** y un plugin de ubicación en segundo plano, reutilizando todo el código web.
