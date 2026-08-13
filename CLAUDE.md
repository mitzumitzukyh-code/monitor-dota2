# Monitor Dota 2

## Qué es esto

Sistema que monitorea partidas profesionales de Dota 2 (arrancando con The
International), calcula la probabilidad de victoria de cada equipo en una
serie, se pone nota a sí mismo contra los resultados reales, y avisa por
Discord.

Proyecto hermano de `Monitor LaLiga` (repo separado) — misma disciplina de
fases, mismo estilo de trabajo, pero **matemática distinta**: Dota no tiene
goles, así que no aplica Dixon-Coles. El motor de fuerza es Elo puro
(actualización secuencial por resultado, como `motor/elo.mjs` de LaLiga),
no una matriz de Poisson.

Un solo usuario: el dueño. **No hay** login, registro, cobro, multiusuario
ni panel de administración. Si una tarea implica cualquiera de esas cosas,
está fuera de alcance — pregunta antes de escribirla.

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
datos/     lo que entra (histórico de partidas profesionales, vía OpenDota)
motor/     elo.mjs, ajustes.mjs
juez/      backtest.mjs, notas.mjs
salida/    discord.mjs
pruebas/   una prueba por cada función del motor
datos/cache/   archivos descargados (en .gitignore)
```

## Fuentes de datos

| Qué | De dónde | Costo |
|---|---|---|
| Partidas profesionales (histórico e individuales) | OpenDota API, `/proMatches` (paginado con `less_than_match_id`) | gratis, sin llave, 60/min, 50.000/mes |
| Torneos / leagueid | OpenDota API, `/leagues` | gratis, sin llave |
| Partidas de un torneo específico | OpenDota API, `/leagues/{id}/matches` | gratis, sin llave (no trae nombre de equipo, hay que resolverlo con `/teams/{id}`) |

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
  verificado: ~20-30% de las series Bo2 terminan así. Es el formato de la
  fase de grupos (formato suizo) de The International. La unidad de
  predicción es la **serie**, no la partida individual, pero el Elo se
  actualiza partida por partida (`motor/elo.mjs`) y la probabilidad de serie
  se deriva de la probabilidad de partida (`motor/series.mjs`).
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

## Orden de fases

```
Fase 0  bajar histórico de partidas profesionales y validarlo
Fase 1  motor Elo + backtest        ← aquí se decide si el proyecto sigue
Fase 2  ajustes (si alguno se gana el puesto contra el backtest)
Fase 3  conectar en vivo (si hay tiempo antes de que termine TI2026)
Fase 4  Discord (si hay tiempo)
```

**No adelantar fases.** No escribir nada de "en vivo" antes de que el motor
pase la prueba del backtest.

## Estilo de trabajo

- Español venezolano, informal, directo. Sin rodeos ni disculpas de más.
- Entregables listos para copiar y pegar, no ensayos explicativos.
- Cada función del motor lleva su prueba con números verificables a mano.
- Antes de escribir código nuevo, revisar si ya existe algo parecido en el
  repo de LaLiga que se pueda adaptar (ej. `motor/elo.mjs`).
- Al terminar una tarea, decir qué quedó pendiente. No declarar victoria a
  medias.
