# Monitor Esports

## Qué es esto

Sistema que monitorea partidas profesionales de deportes electrónicos,
calcula la probabilidad de victoria de cada equipo en una serie, se pone nota
a sí mismo contra los resultados reales, y avisa por Discord.

Arrancó siendo solo Dota 2. Desde el 15 de agosto de 2026 es **multijuego**:
Dota 2, CS2 y League of Legends, con la puerta abierta a Valorant, R6 Siege,
MLBB y Deadlock sin escribir un adaptador nuevo. Ver "Cómo agregar un juego".

Proyecto hermano de `Monitor LaLiga` (repo separado) — misma disciplina de
fases, mismo estilo de trabajo, pero **matemática distinta**: Dota no tiene
goles, así que no aplica Dixon-Coles. El motor de fuerza es Elo puro
(actualización secuencial por resultado, como `motor/elo.mjs` de LaLiga),
no una matriz de Poisson.

**Hoy** es de un solo usuario: el dueño. No hay login, registro, cobro,
multiusuario ni panel de administración, y nada de eso se escribe todavía.

**Más adelante sí**, pero condicionado: ver "Hacia dónde va esto" al final.
Mientras el sistema no se haya ganado el puesto contra el backtest, cualquier
tarea de cobro, cuentas o multiusuario sigue fuera de alcance — pregunta
antes de escribirla.

## Contexto: por qué existe esto ahora

The International 2026 arrancó el 13 de agosto (fase de grupos hasta el 16,
Main Event del 20 al 23, en Shanghái). Ventana real de días, no semanas —
eso presiona el orden de fases pero no lo cancela: sin Fase 0 y Fase 1
limpias, cualquier número que salga es ruido.

## Stack

- JavaScript, módulos ES, extensión `.mjs`. **Nada de TypeScript.**
- Node 20+
- Cero dependencias en `motor/` y `juez/` — es matemática pura
- Supabase para guardar (solo a partir de Fase 3, si se llega)
- Discord webhook para avisos y errores (solo a partir de Fase 4, si se llega)
- Telegram (API de bot) como destino futuro de los avisos — ver "Hacia dónde
  va esto". No escrito todavía.

## Las seis reglas duras

Estas no se negocian. Si un cambio las rompe, no se hace.

1. **Los porcentajes siempre salen del cálculo matemático (Elo).** Ningún
   modelo de lenguaje estima probabilidades. Un LLM solo puede: leer texto
   desordenado y convertirlo en variables, y redactar la narrativa. Nunca
   produce un número que llegue al usuario.

2. **Todos los ajustes se aplican a la fuerza (rating Elo) del equipo,
   nunca a los porcentajes finales.** Si un equipo cambia de roster a
   mitad de temporada, se ajusta su rating (por ejemplo, regresión parcial
   hacia la media). No se le resta 5 puntos al porcentaje de victoria.

3. **Nada llega a Discord ni a la web sin haber pasado por el backtest.**
   Cada funcionalidad nueva se mide contra partidas históricas reales antes
   de activarse en producción.

4. **Cada cosa nueva tiene que ganarse el puesto.** Si al agregar un ajuste
   el Brier score no mejora, el ajuste se corrige o se bota. No se queda
   porque "suena lógico".

5. **Nunca pedir a la API lo que ya está guardado.** Presupuesto real de
   OpenDota (sin llave, verificado 2026-08-13): 60 peticiones/minuto, 50.000
   al mes. Revisar la base/caché antes de pedir. Cachear todo lo que cambia
   lento.

6. **Cero fuga de información temporal.** Al calcular la predicción de una
   serie, el código solo puede ver partidas con `start_time` anterior al
   inicio de esa serie. Si un cálculo puede ver el futuro, el backtest es
   mentira y el proyecto entero no vale nada.

## Estructura

```
datos/          lo que entra
  juegos/       bo3.mjs (adaptador multijuego), bajar-historico.mjs
  liga.mjs      OpenDota — solo Dota 2
  fixtures.mjs  haglund.dev — solo Dota 2
  cache/        archivos descargados (en .gitignore)
motor/          elo.mjs, series.mjs — AGNÓSTICOS del juego
juez/           backtest.mjs, notas.mjs, tabla.mjs, calibrar.mjs
salida/         discord.mjs, formato.mjs, web/
pruebas/        una prueba por cada función del motor
```

`motor/` no sabe de qué juego se trata y así debe quedarse: si una función
del motor necesita preguntar "¿esto es CS2 o Dota?", el juego está mal
modelado y lo que falta es un campo en los datos, no un `if` en el motor.

## Fuentes de datos

| Qué | De dónde | Costo |
|---|---|---|
| Partidas profesionales (histórico e individuales) | OpenDota API, `/proMatches` (paginado con `less_than_match_id`) | gratis, sin llave, 60/min, 50.000/mes |
| Torneos / leagueid | OpenDota API, `/leagues` | gratis, sin llave |
| Partidas de un torneo específico | OpenDota API, `/leagues/{id}/matches` | gratis, sin llave (no trae nombre de equipo, hay que resolverlo con `/teams/{id}`) |
| Calendario de próximos partidos (fixtures) | `https://dota.haglund.dev/v1/matches` (comunidad, cachea Liquipedia) | gratis, sin llave, sin límite documentado -- proyecto no oficial |

### bo3.gg — fuente multijuego, verificada con llamadas reales (2026-08-15)

Gratis, sin llave, sin registro. Cubre **8 disciplinas con el mismo esquema**,
así que un solo adaptador (`datos/juegos/bo3.mjs`) sirve para todas — no hace
falta uno por juego, que era el plan hasta comprobar esto.

| `discipline_id` | slug | juego | partidas jugadas |
|---|---|---|---|
| 1 | csgo | Counter-Strike 2 | 73.165 |
| 2 | valorant | Valorant | — |
| 3 | lol | League of Legends | 14.199 |
| 4 | dota2 | Dota 2 | — |
| 5 / 7 / 8 | deadlock / r6siege / mlbb | — | — |

Lo verificado con llamadas reales, no con documentación:

- `/matches` trae `team1_id`, `team2_id`, `winner_team_id`, marcador,
  `bo_type` (1/3/5), `start_date`, `tier` (s/a/b/c) y `status`.
- **Historial y calendario en el mismo endpoint**: `status=finished` vs
  `status=upcoming`. Eso es mejor que el pipeline de Dota, donde el calendario
  dependía de `haglund.dev` (comunitario, sin SLA) — desde el 2026-08-16
  bo3.gg es el respaldo automático de Dota también (ver "Calendario de
  próximos partidos").
- `status` explícito quita el trabajo de deducir si una serie ya se jugó, y
  `winner_team_id` evita reconstruir la serie partida por partida.
- **Tope duro de 100 filas por página.** Pedir 500 o 1000 igual devuelve 100.
  Paginación por `page[offset]`, verificada sin solapamiento.
- Sin límite de tasa documentado. Se usan 400 ms entre peticiones (regla 5).
- **El offset repite filas si entran partidas nuevas mientras se pagina.**
  `bajarPartidas()` lleva un `Set` de ids vistos por eso; sin él el histórico
  saldría con duplicados.

**Por qué LoL NO usa Leaguepedia.** Se probó primero `lol.fandom.com` (API
Cargo de MediaWiki, gratis y sin llave). Funciona y trae `Winner`, marcador y
`BestOf`, pero: (1) los equipos vienen como **texto** (`"LØS"`, `"Vivo Keyd
Stars"`), no como IDs estables, lo que revive el problema de mapeo de nombres
de LaLiga; (2) **limita por tasa a la tercera llamada**; y (3) devolvió un
`Winner` no nulo para un partido del 17 de agosto que todavía no se jugaba —
riesgo de fuga temporal (regla 6) que quedó **sin aclarar** porque el límite
de tasa cortó la comprobación. bo3.gg no tiene ninguno de los tres problemas.

**Dota 2 sigue en OpenDota, a propósito.** bo3.gg también lo tiene, pero el
Elo de Dota está calibrado sobre las 16.450 partidas de OpenDota y TI2026
está en producción. Cambiarle la fuente por debajo a algo que corre rompe la
regla 3. Migrarlo es una decisión aparte, para después del torneo, y solo si
se gana el puesto contra el backtest.

### Dos bugs reales del pipeline en vivo, encontrados y corregidos (2026-08-14)

1. **Fuga temporal en producción (rompía la regla 6).** El feed de fixtures
   sigue listando series que YA empezaron — verificado: 5 de TI2026 a la vez.
   Con el flujo corriendo cada hora, esas series se predecían usando ratings
   que ya incluían partidas de esa misma serie, y encima sobreescribían la
   predicción original, invalidando el Brier ya calculado. Arreglado en
   `juez/vivo-motor.mjs`: se salta todo fixture cuyo `startsAt` ya pasó, y
   **una predicción guardada nunca se reescribe** (si se reescribe, el Brier
   deja de corresponder a lo que se predijo y el auto-juicio es mentira).

2. **Series distintas del mismo par sumadas como una.** `resultadoDelPar`
   contaba todas las partidas entre dos equipos en toda la liga. En TI un par
   se enfrenta en grupos y puede reenfrentarse en playoffs — las dos series
   se habrían fusionado. Al 14 de agosto todavía no había ninguna revancha
   (por eso no corrompió datos), pero el bracket del 20-23 las garantiza.
   Arreglado acotando por ventana temporal desde el inicio programado y
   cortando el conteo en cuanto la serie se decide. Ojo con la tolerancia
   hacia atrás: las series arrancan antes de lo programado con frecuencia
   (real: LGD vs Nigma arrancó 49 min antes).

### Calendario de próximos partidos — sin fuente oficial gratis

OpenDota **no tiene fixtures**: `/leagues/{id}/matches` y `/proMatches` solo
devuelven partidas YA jugadas, nunca las programadas. La API oficial de
Liquipedia (`api.liquipedia.net`) existe pero requiere solicitar una llave
(proceso de aprobación, no instantáneo) — no viable con la ventana de TI2026
corriendo ya. Se usa en su lugar `dota.haglund.dev/v1/matches`, un proyecto
comunitario que scrapea y cachea (3 horas) el calendario de Liquipedia.
Verificado con una llamada real (2026-08-13): trae el `Team Spirit vs
Aurora Gaming`, `Team Yandex vs Team Liquid` reales de la Ronda 2 de TI2026,
con `startsAt`, nombres de equipo y `matchType` ("Bo3"). Sin SLA ni límite
de tasa documentado — no golpear más de una vez cada 15-30 minutos (regla
5, y porque ellos mismos cachean 3h del lado de Liquipedia).

**Respaldo automático en bo3.gg (2026-08-16).** haglund.dev se cayó con 500
sostenido y el ciclo empezó a fallar (corridas 112+, aviso a Discord cada 10
min). Arreglado en `datos/fixtures.mjs`: si haglund no responde, el ciclo usa
el calendario de bo3.gg (`/matches?status=upcoming`, discipline dota2),
filtrado al `tournament_id` de TI2026 (5134, verificado con llamadas reales:
trae las series reales del Main Event 20-23 de agosto con equipos resueltos
por nombre contra el mapeo de OpenDota). No cambia el motor ni el histórico:
solo elige de dónde sale el calendario. Como cada fuente tiene su propio id
para la MISMA serie, `juez/vivo-motor.mjs` ahora también descarta candidatas
cuyo par de equipos ya tiene una serie guardada con fecha cercana (12h) —
sin eso, una serie predicha con id de bo3.gg se re-predeciría con id de
haglund al volver y el Brier sería mentira. El pipeline sigue sin inventar
cruces: si ninguna fuente responde, falla explícito.

### OpenDota — verificado con llamadas reales (2026-08-13)

- `/leagues` → 200, 10.057 torneos reales. Confirmado el `leagueid` de cada
  edición de The International: 2012=65001, 2013=65006, 2014=600,
  2015=2733, 2016=4664, 2017=5401, 2018=9870, 2019=10749, 2021=13256,
  2022=14268, 2023=15728, 2024=16935, 2025=18324, **2026=19719**.
- `/proMatches` → 200, partidas reales de hoy incluidas (The International
  2026, equipos reales: TEAM VISION, Team Falcons, LGD Gaming, Team
  Resilience). Trae `radiant_name`/`dire_name` directo — no hace falta
  resolver `team_id` por separado para este endpoint.
- `/proMatches?less_than_match_id=X` → paginación confirmada, retrocede en
  el tiempo correctamente (probado: página siguiente cayó del 5 al 1 de
  agosto 2026).
- `/leagues/{id}/matches` → 200, pero `radiant_team_name`/`dire_team_name`
  vienen `null`. Hay que resolver con `/teams/{id}` (probado con The
  International 2023: 8599101 → Gaimin Gladiators, 7119388 → Team Spirit,
  coincide con la final real de ese año).
- **`radiant_score`/`dire_score` son conteo de kills, NO implican quién
  ganó la partida.** El campo autoritativo es `radiant_win` (booleano).
  A diferencia de fútbol, no hay invariante "más goles gana" que validar.
- OpenDota trae su propio campo `rating` por equipo (Glicko/Elo de ellos).
  **Nunca usarlo como nuestra probabilidad** — es de referencia externa,
  no el cálculo propio (regla 1).
- Una serie (`series_id`) agrupa varias partidas. `series_type` confirmado
  con datos reales (cruzado contra cantidad real de partidas jugadas por
  serie): 0=Bo1, 3=Bo2, 1=Bo3, 2=Bo5. **Bo2 admite empate real (1-1)** —
  verificado: ~20-30% de las series Bo2 terminan así. La unidad de
  predicción es la **serie**, no la partida individual, pero el Elo se
  actualiza partida por partida (`motor/elo.mjs`) y la probabilidad de serie
  se deriva de la probabilidad de partida (`motor/series.mjs`).
  **Corrección (2026-08-13): la fase de grupos de TI2026 es Bo3, NO Bo2.**
  Verificado con las 29 partidas reales ya jugadas (100% `series_type=1`) y
  el calendario real de próximas rondas (100% "Bo3"). La suposición inicial
  ("formato suizo = Bo2") vino de investigación genérica, no de datos
  reales de esta edición — quedó mal. Bo2 sigue siendo real en otros
  torneos del histórico (ver deltaBo2 abajo), solo que no es crítico para
  TI2026 esta vez.
- `/proMatches` mezcla TODOS los tiers de torneo, incluido `excluded`
  (amateur). Es la mitad del dataset. Filtrar a `professional`/`premium`
  (cruzando con `/leagues`) mejora el Brier de bo1/bo3/bo5 de forma real —
  se ganó el puesto (regla 4), ver `juez/calibrar.mjs`. `datos/historico.mjs`
  ya lo hace automático.

### Backtest real (2026-08-13) — motor Elo + conversión a serie

Corrido contra `datos/historico.json` (16.450 partidas, solo
professional/premium), sweep de K_FACTOR/ESCALA en `juez/calibrar.mjs`
(35 combinaciones). Ganador: K=24, escala=400 (config.mjs).

| Formato | Brier del motor | Brier base ingenua | ¿Se gana el puesto? |
|---|---|---|---|
| bo1 | 0.4875 | 0.5 | sí, modesto |
| bo3 (67% de las series) | 0.4735 | 0.5 | sí, modesto |
| bo5 | 0.4587 | 0.5 | sí |
| bo2 (fase de grupos de TI) | 0.5977 | 0.6667 | sí, con el ajuste de abajo |

**bo2 tenía un problema real, ya resuelto:** con la fórmula binomial pura
(partidas independientes dentro de la serie), el modelo predecía ~47% de
probabilidad de empate en promedio contra una tasa real de ~20% — perdía
contra la base ingenua (0.7083). Ningún ajuste de K_FACTOR/ESCALA lo
arreglaba porque no era un problema de escala: las dos partidas de un Bo2
NO son independientes en la realidad (ganar la partida 1 aumenta la chance
de ganar la 2 más de lo que el rating por sí solo explica).

Se agregó `deltaBo2` a `motor/series.mjs`: desplaza la probabilidad
condicional de la partida 2 en escala logit según quién ganó la partida 1.
Con `deltaBo2=0` se reduce exactamente a la fórmula binomial vieja (por
eso no rompió nada). Sweep real: `deltaBo2=1.4` minimiza el Brier de bo2 en
0.5977, y en ese punto el modelo predice 19.0% de empate en promedio —
casi exactamente la tasa real observada, buena señal de que el ajuste
capturó la causa real y no sobreajustó ruido. Valor calibrado en
`config.mjs` (`DELTA_BO2`).

## Primera medición en vivo real (2026-08-14) — TI2026 Round 2 y 3

Ocho series predichas el 13 de agosto antes de jugarse, calificadas contra
el resultado real:

| | |
|---|---|
| Brier promedio | **0.6043** (base ingenua bo3: 0.5) |
| Mediana | 0.4319 |
| Series mejores que la ingenua | 5 de 8 |
| Aciertos del favorito | 5 de 8 |
| Intervalo ~95% de la media | [0.3039, 0.9047] |

**No se puede concluir nada de esto todavía.** Con n=8 el intervalo de
confianza contiene a la base ingenua, así que el resultado es compatible
tanto con "el motor sirve" como con "no sirve". La media está arrastrada por
un solo upset: Iron Wing (predicho 12.3%) le ganó 2-1 a Team Falcons, con un
Brier de 1.5379 — más del doble que cualquier otra serie. La mediana (0.4319)
y el conteo (5 de 8 bajo 0.5) apuntan en la dirección opuesta a la media.

Revisado: ese 12.3% no fue un número inventado. Iron Wing tenía 29 partidas
reales de historial y rating 1575, contra 334 partidas y 1796 de Falcons.
La evidencia con peso estadístico sigue siendo el backtest de 8.116 series
(bo3 = 0.4735), no esta muestra.

**Hipótesis pendiente para Fase 2:** el Elo clásico no expresa incertidumbre.
Un equipo con 29 partidas tiene un rating mucho menos confiable que uno con
334, pero el modelo trata los dos igual y produce probabilidades igual de
extremas. El proyecto de LaLiga maneja esto con suavizado bayesiano
(`PESO_PRIOR_PARTIDOS`); acá no hay equivalente. Encoger la probabilidad
hacia 0.5 en proporción a la poca experiencia es testeable contra el
backtest — si no baja el Brier, se bota (regla 4).

### Elo vs Glicko-2 en los tres juegos — tabla única (2026-08-17)

Misma metodología para los tres: barrido sobre el 80% viejo, veredicto sobre
el 20% reciente que el barrido nunca vio, y test **pareado** (los dos motores
predicen la misma partida) para la significancia. Nivel de comparación: la
partida, que es donde los dos motores actualizan.

| | n | Elo calibrado | Glicko-2 calibrado | t (pareado) | veredicto |
|---|---|---|---|---|---|
| **CS2** | 12.447 | 0.22273 | **0.22057** | −4.31 | **Glicko-2 gana** |
| **Dota 2** | 2.318 | 0.23074 | 0.22921 | −1.89 | empate |
| **LoL** | 2.444 | **0.21259** | 0.21490 | +1.47 | empate |
| **Valorant** | 2.350 | **0.23178** | 0.23209 | +0.24 | empate |

Base ingenua: 0.25000 para CS2, LoL y Valorant (una sola clase). Dota puntúa
sobre tres clases, así que la suya es 0.50 — **sus Brier no son comparables
con los otros tres**, ver `salida/resumen-global.mjs`.

Contra su propia base, de mejor a peor: LoL −15%, CS2 −11.8%, Valorant −7.3%,
Dota −7.7%.

**Sólo en CS2 hay un ganador.** En Dota, LoL y Valorant el intervalo contiene
el cero,
así que ninguno le gana al otro — y por la regla 4, lo nuevo que no se gana el
puesto no entra: **Dota se queda en Elo**. Está cerca (t = −1.89, casi al
borde), pero "casi" no es haberlo ganado.

Nota: en Dota el barrido eligió **K=24, escala=400**, exactamente los valores
que ya estaban en producción desde el 13 de agosto. La calibración original
era correcta.

LoL es el juego que mejor se predice (0.213), después CS2 (0.221) y de último
Dota (0.229).

#### Error de método corregido, y qué números invalidó

Hasta el 2026-08-17 la evaluación del holdout se corría pasándole **sólo** el
20% de prueba, con los ratings en blanco. Eso reconstruía todo desde cero: los
equipos llegaban al holdout casi sin historial, muy lejos de lo que pasa en
producción, donde el rating trae encima todo el pasado.

No era fuga temporal (nunca se miró el futuro) y no cambió **ninguna
conclusión**, porque los tests de significancia siempre fueron continuos. Pero
los Brier absolutos que se reportaron antes estaban subestimados:

| | reportado antes | real |
|---|---|---|
| CS2 · Glicko-2 | 0.22905 | 0.22057 |
| LoL · Elo | 0.21326 | 0.21259 |

`puntuarDesde` en `juez/calibrar-juego.mjs` separa ahora lo que se aplica de
lo que se puntúa. La señal que delató el error fue que el agregado y el
pareado daban signos distintos en Dota; si los dos hubieran estado mal igual,
no se habría notado.

### Fase 1 de CS2 — cerrada (2026-08-15). Glicko-2 se ganó el puesto

Barrido con **separación cronológica 80/20**: se calibró con las 58.103
partidas viejas y se reportó sobre las 14.527 recientes, que el barrido nunca
vio. Esa separación no es adorno — sin ella se estaría midiendo cuál
combinación tuvo más suerte, que es exactamente el error que costó la Fase 2
de LaLiga (68 combinaciones, "mejora" de 0.055% que era ruido).

Sobre el holdout:

| | Brier | Acierto |
|---|---|---|
| base ingenua (50-50) | 0.25000 | — |
| Elo con los coeficientes de **Dota** (24/400) | 0.23386 | 60.70% |
| Elo calibrado para CS2 (20/200) | 0.23190 | 61.25% |
| **Glicko-2 calibrado (tau 1.2, RD 200)** | **0.22905** | **62.40%** |

Pareado contra el Elo ya calibrado: dif media **−0.002162**, IC95
**[−0.003145, −0.001179]**, **t = −4.31** sobre n = 12.447. Concluyente.

Esto cierra la duda que había quedado abierta: Glicko-2 no gana sólo porque
el Elo estuviera mal afinado, gana también contra un Elo afinado para CS2.

Dos cosas que dejó ver el barrido y conviene no olvidar:

- **En Elo manda la razón K/escala, no los valores sueltos.** K=20/escala=200
  y K=40/escala=400 dieron brier idéntico. "Subir K" sin tocar la escala no
  es acelerar el aprendizaje, es cambiar esa razón.
- **En Glicko-2 lo que movió la aguja fue el RD inicial (200, no los 350 del
  paper); TAU casi no importó.** Con RD 200 los cinco valores de TAU probados
  quedaron dentro de 0.00001 de Brier.

**Dota 2 sigue en Elo.** Glicko-2 no se ha probado contra su histórico, y un
juego no hereda la aprobación de otro. Los coeficientes por juego viven en
`COEFICIENTES` de `config.mjs`.

## Orden de fases

Las fases son **por juego**. Dota 2 va en la 4; CS2 arrancó Fase 0 el 15 de
agosto de 2026; LoL no ha arrancado.

```
Fase 0  bajar histórico y validarlo
Fase 1  motor Elo + backtest        ← aquí se decide si ESE juego sigue
Fase 2  ajustes (si alguno se gana el puesto contra el backtest)
Fase 3  conectar en vivo
Fase 4  avisos (Discord hoy, Telegram después)
Fase 5  monetización              ← ver "Hacia dónde va esto"
```

**No adelantar fases.** No escribir nada de "en vivo" antes de que el motor
pase la prueba del backtest, y nada de la Fase 5 antes de que el Brier le gane
a la base ingenua de forma concluyente.

## Cómo agregar un juego

La arquitectura está pensada para que agregar Valorant, R6 Siege o MLBB sea
configuración, no código nuevo. El motor (`motor/elo.mjs`, `motor/series.mjs`)
es agnóstico del juego: Elo y la conversión Bo1/Bo3/Bo5 no saben de qué
deporte se trata.

Pasos, en orden, sin saltarse ninguno:

1. **Confirmar que bo3.gg lo cubre.** Está en `DISCIPLINAS` de
   `datos/juegos/bo3.mjs`. Si el juego no está ahí, hay que buscar fuente y
   verificarla con llamadas reales antes de escribir nada.
2. **Fase 0:** `node datos/juegos/bajar-historico.mjs <juego>`. Deja el
   histórico en `datos/cache/historico-<juego>.json`.
3. **Validar el histórico.** Duplicados, fechas coherentes, marcador que
   cuadre con el ganador. Si no está limpio, el resto no vale nada.
4. **Fase 1: calibrar K_FACTOR y ESCALA para ESE juego.** No se heredan los
   de Dota. Un Bo3 de CS2 y un Bo3 de Dota no tienen la misma varianza, y los
   coeficientes de Dota (K=24, escala=400) salieron de un barrido sobre datos
   de Dota. Correr el barrido de nuevo, por juego.
5. **Filtrar por `tier`.** En Dota, filtrar a `professional`/`premium` mejoró
   el Brier de verdad (regla 4). bo3.gg trae `tier` (s/a/b/c): el mismo
   experimento hay que repetirlo, no darlo por hecho.
6. **Solo si el Brier le gana a la base ingenua**, conectar en vivo. Si no,
   se bota el juego, no se "ajusta hasta que dé" (regla 4).

Un juego nuevo **no hereda la aprobación de otro**. Que CS2 funcione no dice
nada de si Valorant va a funcionar.

## Hacia dónde va esto

Esto es el destino, **no lo que hay hoy**. Nada de esta sección se escribe
hasta que se cumpla la condición de arriba de cada punto.

- **Avisos por Telegram (API de bot, a un canal).** Reemplaza o acompaña a
  Discord.
  **Condición:** que el sistema haya pasado las pruebas reales.

  **Cómo funciona** (verificado contra la documentación oficial, 2026-08-17):
  el token sale de `@BotFather` y se envía con
  `POST https://api.telegram.org/bot<TOKEN>/sendMessage`, con `chat_id`
  (el `@nombre` del canal público, o un número negativo si es privado) y
  `text`.

  Dos ventajas concretas sobre Discord:
  - **Un token, muchos destinos.** Hoy hacen falta dos secretos
    (`DISCORD_WEBHOOK` y `DISCORD_WEBHOOK_ERRORES`) porque cada canal necesita
    su URL. Con Telegram es un token y varios `chat_id`; agregar un canal por
    juego no cuesta un secreto nuevo.
  - **Límite de 4.096 caracteres**, no 2.000. La ventana de 24 h que se puso
    en `discord-esports.mjs` existe porque el mensaje de LoL se truncaba; en
    Telegram no habría hecho falta.

  **El costo real NO es reescribir `enviar()`.** Eso se dijo antes y era
  incompleto. Las funciones que arman el mensaje son puras y no cambian, pero
  el **formato sí**: Discord usa `**negrita**`; Telegram MarkdownV2 usa
  `*negrita*` y obliga a escapar `_ * [ ] ( ) ~ > # + - = | { } . !`. Los
  mensajes actuales están llenos de puntos, guiones y paréntesis
  (`2–0`, `0.4183`, `(le dábamos 70%)`), y los nombres de equipo vienen de
  terceros, así que pueden traer cualquier cosa. Sin escapar, Telegram
  responde 400.
  **Camino más corto: `parse_mode: "HTML"`**, que sólo obliga a escapar
  `<`, `>` y `&` — exactamente lo que `esc()` del panel web ya hace.

  **Para cobrar: Telegram Stars.** Suscripciones con renovación automática;
  Telegram cobra y gestiona el acceso, así que no hay que escribir nada de
  pagos. Ojo con dónde queda el dinero: si la suscripción es **al canal**, las
  Stars van al balance del canal; si es **vía bot**, al balance del bot.
  (Enviar más de 30 mensajes por segundo cuesta 0,1 Stars cada uno con
  `allow_paid_broadcast` — con el volumen actual, irrelevante.)

- **Monetizar la información: análisis de partidas y prestaciones.**
  Implica lo que hoy está prohibido — cuentas, cobro, multiusuario.
  **Condición, y no es negociable:** que el Brier le gane a la base ingenua
  con una muestra que lo haga concluyente. Al 15 de agosto de 2026 el sistema
  va en **Brier 0.4183 con n=17**, y el intervalo de confianza todavía
  contiene a la base ingenua: el resultado es compatible con "el motor sirve"
  y con "no sirve". Cobrar en ese estado es vender algo que no se ha probado,
  y además rompe las reglas 3 y 4 del propio proyecto.
  Cuando llegue el momento, tres cosas que hay que resolver antes de escribir
  código: (1) esto vive cerca de las apuestas y hay jurisdicciones que lo
  regulan — averiguar cuál aplica; (2) mostrar el historial de aciertos
  completo, incluidos los fallos, no solo los aciertos; (3) decidir qué se
  vende exactamente — el número, la narrativa, o el acceso al panel.

- **Más juegos:** Valorant, R6 Siege, MLBB, Deadlock. Ver "Cómo agregar un
  juego". La fuente ya los cubre; falta el paso 4 de cada uno.

- **Migrar Dota 2 de OpenDota + haglund.dev a bo3.gg.**
  **Condición: que TI2026 haya terminado (23 de agosto).** Hacerlo antes
  rompe la regla 3 — es cambiarle la fuente por debajo a algo que está en
  producción, con predicciones que no se pueden rehacer si se pierden.

  Por qué vale la pena: `haglund.dev` es el único calendario de Dota, es un
  proyecto comunitario sin SLA, y es el punto más frágil del pipeline. bo3.gg
  ya cubre Dota (`discipline_id: 4`) con historial y calendario en el mismo
  endpoint, `status` explícito y `winner_team_id` directo.

  Los cuatro pasos, en orden:
  1. `node datos/juegos/bajar-historico.mjs dota2` y validarlo (duplicados,
     fechas futuras, ganador coherente con el marcador).
  2. `node juez/calibrar-juego.mjs dota2` contra ESE histórico. Los
     coeficientes actuales (K=24, escala=400) salieron del histórico de
     OpenDota; con otra fuente hay que recalibrar, no heredar.
  3. Comparar el Brier nuevo contra el de la fuente vieja. Si empeora, no se
     migra: la fragilidad de haglund.dev es un problema de disponibilidad, no
     una excusa para predecir peor.
  4. Recién ahí, apuntar el ciclo de Dota a `juez/vivo-esports.mjs` (que ya
     es multijuego) y retirar `datos/fixtures.mjs`.

  **Lo que NO hay que hacer:** migrar y calibrar en el mismo paso. Si el
  Brier cambia, no se sabría si fue por la fuente o por los coeficientes.

## Estilo de trabajo

- Español venezolano, informal, directo. Sin rodeos ni disculpas de más.
- Entregables listos para copiar y pegar, no ensayos explicativos.
- Cada función del motor lleva su prueba con números verificables a mano.
- Antes de escribir código nuevo, revisar si ya existe algo parecido en el
  repo de LaLiga que se pueda adaptar (ej. `motor/elo.mjs`).
- Al terminar una tarea, decir qué quedó pendiente. No declarar victoria a
  medias.
