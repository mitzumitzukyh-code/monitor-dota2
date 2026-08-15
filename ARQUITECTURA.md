# Arquitectura

Mapa del proyecto para orientarse rápido. `CLAUDE.md` dice **qué** se hace y
**por qué**; esto dice **dónde está** y **cómo fluye**. Si vas a tocar algo,
lee la sección de tu capa y la de "Invariantes".

## El flujo, de punta a punta

```
  FUENTES                 MOTOR                JUEZ              SALIDA
  ───────                 ─────                ────              ──────
  bo3.gg ──┐
  (multi)  │  historial   elo.mjs          backtest.mjs      discord.mjs
           ├─ ─────────►  (rating por  ──► (mide contra  ──► formato.mjs
  OpenDota │  fixtures    equipo)          el pasado)         web/generar.mjs
  (dota2)  │              series.mjs       notas.mjs
           │              (rating →        (Brier,           Supabase
  haglund ─┘              prob. de         log loss)         (estado)
  (dota2)                 serie)
```

Regla de oro del flujo: **la información va en una sola dirección.** `motor/`
no importa nada de `datos/`, `juez/` no importa nada de `salida/`. Si te
encuentras necesitando una flecha hacia atrás, el diseño está mal.

## Las capas, y qué puede tocar cada una

| Carpeta | Responsabilidad | Puede importar de | Dependencias externas |
|---|---|---|---|
| `datos/` | Traer datos crudos y normalizarlos | nada del proyecto | fetch |
| `motor/` | Matemática pura: rating y probabilidad | nada | **ninguna** |
| `juez/` | Medir el motor contra la realidad | `motor/`, `datos/` | **ninguna** |
| `salida/` | Mostrar: Discord, web | `juez/`, `datos/` | fetch |
| `pruebas/` | Una prueba por función del motor | todo | node:test |

`motor/` y `juez/` con **cero dependencias** no es estética: es lo que
permite verificar cada número a mano y que el backtest no dependa de nada
que pueda cambiar por debajo.

## Dónde tocar según lo que quieras hacer

| Quiero... | Voy a... |
|---|---|
| Agregar un juego nuevo | `CLAUDE.md` § "Cómo agregar un juego" |
| Cambiar cómo se calcula la probabilidad | `motor/elo.mjs`, `motor/series.mjs` |
| Cambiar un coeficiente | `config.mjs` — **nunca** un número suelto en una función |
| Cambiar el texto de un aviso | `salida/discord.mjs`, las funciones `mensaje*` |
| Cambiar a Telegram | solo `enviar()` de `salida/discord.mjs` (ver abajo) |
| Cambiar el panel web | `salida/web/generar.mjs`, `salida/web/grilla.mjs` |
| Agregar una tabla | `sql/` con un archivo `migracion-*.sql` nuevo |
| Entender por qué algo está así | `CLAUDE.md` — casi todo tiene su porqué escrito |

## Por qué "armar el mensaje" y "enviarlo" están separados

En `salida/discord.mjs` las funciones `mensajePredicciones`,
`mensajeResultados` y `mensajeResumenDia` son **puras**: reciben datos,
devuelven texto, no tocan la red. `enviar()` es la única que sale a internet.

Dos razones: las puras se prueban sin simular nada, y cambiar de destino
(Telegram, por ejemplo) es reescribir `enviar()` sin tocar una sola línea de
lo que dice el mensaje.

## Invariantes — romper una de estas es un bug, no una opción

1. **`motor/` no sabe de qué juego se trata.** Si una función necesita
   preguntar "¿esto es CS2 o Dota?", falta un campo en los datos, no sobra
   un `if`.
2. **Nunca se reescribe una predicción ya guardada.** Si se reescribe, el
   Brier deja de corresponder a lo que se predijo y el auto-juicio es
   mentira. Ya pasó una vez (ver `CLAUDE.md`, bugs del 2026-08-14).
3. **Nada se predice después de que la partida arrancó.** El feed de fixtures
   sigue listando series ya empezadas. `juez/vivo-motor.mjs` las salta.
4. **Toda fecha se compara en UTC; solo se convierte a hora Venezuela al
   mostrar.** `salida/formato.mjs` es el único lugar que hace esa conversión.
5. **Los coeficientes viven en `config.mjs`.** Un número mágico dentro de una
   función es un cambio que nadie va a poder auditar después.

## Seguridad

Lo que ya está aplicado y **por qué**, para que no se desarme por accidente:

- **Secretos solo en `.env` y en GitHub Secrets.** Nunca en el código.
  `.env` está en `.gitignore` desde el primer commit y se verificó que nunca
  estuvo en el historial de git.
- **El workflow no se dispara con `pull_request`.** Es a propósito: el repo
  es público, y con ese disparador un fork podría leer los secretos. Los
  disparadores son `schedule`, `workflow_dispatch` y `push` a `main`, y a
  `main` solo empuja el dueño. **Si alguna vez agregas `pull_request` o
  `pull_request_target` a este workflow, estás exponiendo la llave de
  Supabase.**
- **Permisos mínimos en el workflow:** `contents: read`, más `pages: write` e
  `id-token: write` que hacen falta para publicar el panel. Nada de
  `contents: write`.
- **Todo dato externo se escapa antes de entrar al HTML.** Los nombres de
  equipo vienen de APIs de terceros y el panel se publica en GitHub Pages:
  sin escapar, un nombre con `<script>` sería XSS almacenado. `esc()` en
  `salida/web/generar.mjs` y `salida/web/grilla.mjs`. **Si agregas una
  interpolación con datos de la API, pásala por `esc()`.**
- **Discord con las menciones desactivadas.** `enviar()` manda
  `allowed_mentions: { parse: [] }`. Un equipo llamado `@everyone` haría que
  el bot pingue a todo el servidor en cada aviso, y ese nombre lo controla
  quien lo registró en la fuente, no nosotros.
- **Toda petición externa pasa por `datos/reintentar.mjs`.** Reintenta 5xx,
  429 y fallos de red; **no** reintenta 4xx, porque un 404 repetido sigue
  siendo 404 y solo gasta presupuesto (regla 5).
- **Supabase: lectura pública, escritura solo con `service_role`.** RLS
  activo en todas las tablas. Ojo con el gotcha ya documentado: RLS no basta,
  hay que dar el `GRANT` explícito porque Supabase no lo otorga en tablas
  creadas desde el SQL Editor.
- **La llave que anda por ahí es `service_role`, que puede todo.** Si alguna
  vez el panel web necesita leer de Supabase desde el navegador, usa la llave
  `anon`, nunca esta.

Lo que **no** está resuelto y hay que tener presente:

- **Los reintentos cubren tropiezos, no caídas largas.** `datos/reintentar.mjs`
  aguanta segundos (500ms, 1s, 2s, tope 8s). El 2026-08-15 OpenDota estuvo
  abajo ~40 minutos: contra eso no hay defensa, si la fuente no está no hay
  dato. El ciclo falla, pero ahora avisa a Discord en vez de fallar en
  silencio.
- No hay validación de esquema de lo que devuelven las APIs. Si bo3.gg
  cambia un campo de nombre, se detecta cuando algo salga en blanco, no
  antes.
- `haglund.dev` sigue siendo el único calendario de Dota y no tiene SLA.
  bo3.gg ya lo cubriría, pero migrarlo con TI2026 en producción rompe la
  regla 3. Es tarea para después del torneo.
- El repo se llama `monitor-dota2` pero el proyecto es multijuego. Renombrar
  está pendiente.

## Convenciones

- Español en nombres de función, variables y comentarios. Los campos que
  vienen de una API se dejan como los manda la API (`radiant_win`,
  `winner_team_id`) y se traducen al normalizar.
- Módulos ES, `.mjs`, sin TypeScript.
- Los comentarios explican **por qué**, no qué. Si un comentario repite lo
  que el código ya dice, sobra.
- Cada hallazgo real (bug, límite de una API, dato malo) se documenta en
  `CLAUDE.md` con su fecha. Eso es lo que evita repetir el mismo error en la
  sesión siguiente.
