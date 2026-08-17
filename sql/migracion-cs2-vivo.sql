-- Fase 3 multijuego: ratings, predicciones y estado de sincronización.
--
-- POR QUÉ LOS RATINGS VAN EN LA BASE Y NO EN UN ARCHIVO
-- Dota versiona datos/historico.json (4.2 MB) y recalcula desde cero en cada
-- corrida. Con CS2 ese archivo son 13.2 MB, y con LoL y Valorant detrás el
-- repo se llenaría de blobs que cambian en cada partida. Acá se guarda el
-- ESTADO (el rating de cada equipo) y se le aplican sólo las partidas nuevas.
--
-- El precio de esto es que el estado puede quedar corrupto si una corrida se
-- interrumpe a medias. Por eso existe eslo_estado: guarda hasta qué fecha se
-- aplicó, así se puede auditar y reconstruir desde el histórico si hiciera
-- falta.

-- Rating actual de cada equipo, por juego.
create table if not exists eslo_ratings (
  juego            text        not null,
  team_id          bigint      not null,
  rating           numeric     not null,
  rd               numeric     not null,
  vol              numeric     not null,
  partidas         int         not null default 0,
  actualizado_en   timestamptz not null default now(),
  primary key (juego, team_id)
);

-- Hasta dónde se aplicaron partidas, por juego. Una fila por juego.
create table if not exists eslo_estado (
  juego                 text        primary key,
  ultimo_inicio         timestamptz,
  ultimo_match_id       bigint,
  partidas_aplicadas    int         not null default 0,
  actualizado_en        timestamptz not null default now()
);

-- Predicciones. La clave es match_id: una partida se predice UNA vez y no se
-- reescribe nunca (si se reescribe, el Brier deja de corresponder a lo que se
-- predijo y el auto-juicio es mentira -- bug real ya vivido en Dota).
create table if not exists eslo_predicciones (
  match_id           bigint      primary key,
  juego              text        not null,
  equipo_a           bigint      not null,
  equipo_b           bigint      not null,
  inicio_programado  timestamptz not null,
  formato            text,
  motor              text        not null,
  prob_a             numeric     not null,
  prob_b             numeric     not null,
  -- Se guarda el estado con el que se predijo: sin esto no se puede auditar
  -- despues por que salio ese numero.
  rating_a           numeric,
  rd_a               numeric,
  rating_b           numeric,
  rd_b               numeric,
  creada_en          timestamptz not null default now(),
  -- Calificación, se llena después.
  resultado_real     text,
  marcador_a         int,
  marcador_b         int,
  brier              numeric,
  calificada_en      timestamptz
);

create index if not exists eslo_predicciones_pendientes_idx
  on eslo_predicciones (juego, inicio_programado) where resultado_real is null;

alter table eslo_ratings      enable row level security;
alter table eslo_estado       enable row level security;
alter table eslo_predicciones enable row level security;

drop policy if exists "lectura publica eslo_ratings" on eslo_ratings;
create policy "lectura publica eslo_ratings" on eslo_ratings for select using (true);
drop policy if exists "lectura publica eslo_estado" on eslo_estado;
create policy "lectura publica eslo_estado" on eslo_estado for select using (true);
drop policy if exists "lectura publica eslo_predicciones" on eslo_predicciones;
create policy "lectura publica eslo_predicciones" on eslo_predicciones for select using (true);

grant select on eslo_ratings, eslo_estado, eslo_predicciones to anon;
grant select, insert, update, delete on eslo_ratings, eslo_estado, eslo_predicciones to service_role;
