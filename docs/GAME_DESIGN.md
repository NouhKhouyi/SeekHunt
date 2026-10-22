# SeekHunt: diseño del juego

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

## Mecánicas para equilibrar

| Mecánica | Por qué existe |
|---|---|
| **Código de captura** (4 cifras en el móvil del escondido) | Una "pillada" no se puede comprobar por GPS (el error es de 5 a 20 m). El cazador tiene que tocar al escondido y teclear su código. Más adelante se podría escanear un QR o usar NFC. |
| **"Me han pillado"** | Si el código falla, el propio escondido se rinde. |
| **Fuera de zona** | Quien sale de la zona queda **revelado** al cazador y tiene `outOfZoneGraceSeconds` para volver. Si no vuelve, queda eliminado. |
| **Radar** cada `pingIntervalSeconds` | El cazador ve un círculo aproximado (±`pingFuzzMeters`) de cada escondido, y los escondidos ven la posición exacta del cazador. Así ninguno de los dos bandos va a ciegas. |
| **Señal perdida** | A quien deja de enviar ubicación durante `staleLocationSeconds`, el cazador lo ve en su última posición conocida. Así nadie gana nada apagando el GPS. |
| **Modo infección** (`caughtBecomeSeekers`) | Los pillados pasan a ser cazadores. Funciona bien en grupos grandes. |
| **Saltos imposibles** | Se descartan las posiciones que implican más de 60 m/s. Es un antitrampas ligero contra GPS falso. |

## Seguridad y privacidad (requisitos, no extras)

- Las zonas se eligen sin carreteras grandes, vías de tren, agua ni propiedades privadas. La pantalla de inicio lo recuerda.
- La ubicación solo se comparte mientras hay una partida abierta, y la sala se borra tras 12 h sin actividad.
- Cada jugador recibe una **vista personalizada**: el servidor nunca envía a un cliente posiciones que no debe ver, así que tampoco se pueden sacar del inspector del navegador.
- Pendiente: un botón de emergencia o pausa global, y un aviso de quedar en un punto al terminar.

## Ideas para siguientes versiones

- Habilidades con cooldown: señuelo, invisibilidad durante el radar, "sonar" del cazador.
- Zonas en forma de polígono (siguiendo calles o un parque) en lugar de círculos.
- Varios equipos, o un modo "Jet Lag" con preguntas y cartas.
- Historial de partida con la repetición del recorrido de cada jugador al final.
- App nativa con Capacitor para tener ubicación en segundo plano (ver limitaciones).

## Limitación técnica clave: GPS con la pantalla apagada

En iOS, una web/PWA **no recibe ubicación con la pantalla bloqueada**, y en Android también es poco fiable. La v1 lo resuelve así:
- usa Wake Lock para mantener la pantalla encendida;
- avisa en la interfaz de que hay que mantener la pantalla encendida;
- revela al jugador si su posición se queda antigua.

Si al probarlo resulta un problema, el siguiente paso es empaquetarla con **Capacitor** y un plugin de ubicación en segundo plano, reutilizando todo el código web.
