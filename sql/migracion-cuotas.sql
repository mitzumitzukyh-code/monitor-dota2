-- Cuotas de casa de apuestas, capturadas de bo3.gg.
--
-- Por qué una tabla nueva y no una columna: bo3.gg borra la cuota en cuanto
-- la partida pasa, y la cuota se MUEVE antes del saque. Se guarda una fila
-- por captura (no una por partida) para tener el movimiento, que es
-- información por sí sola.
--
-- Sin prefijo dota_ a propósito: esta tabla es multijuego desde el arranque,
-- a diferencia de las dota_* que nacieron cuando el proyecto era de un juego.

create table if not exists eslo_cuotas (
  match_id           bigint      not null,
  capturado_en       timestamptz not null default now(),
  juego              text        not null,
  disciplina_id      int         not null,
  equipo_a           bigint      not null,
  equipo_b           bigint      not null,
  coeff_a            numeric     not null,
  coeff_b            numeric     not null,
  -- Probabilidades ya normalizadas (sin el margen de la casa). Se guardan
  -- calculadas para no tener que repetir la fórmula en cada consulta y que
  -- se separen las versiones.
  prob_a             numeric     not null,
  prob_b             numeric     not null,
  margen             numeric     not null,
  inicio_programado  timestamptz,
  proveedor_id       int,
  primary key (match_id, capturado_en)
);

-- La consulta que de verdad importa: "la última cuota ANTES del saque de
-- cada partida", que es la única comparable contra la predicción (regla 6).
create index if not exists eslo_cuotas_partida_idx
  on eslo_cuotas (match_id, inicio_programado, capturado_en desc);

create index if not exists eslo_cuotas_juego_idx on eslo_cuotas (juego, inicio_programado);

alter table eslo_cuotas enable row level security;

-- Lectura pública, escritura solo con service_role: mismo criterio que las
-- tablas dota_*. RLS no basta -- Supabase no otorga GRANT en tablas creadas
-- desde el SQL Editor (gotcha ya documentado en CLAUDE.md).
create policy "lectura publica eslo_cuotas" on eslo_cuotas for select using (true);

grant select on eslo_cuotas to anon;
grant select, insert, update, delete on eslo_cuotas to service_role;
