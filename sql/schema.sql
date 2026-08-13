-- Monitor Dota 2 -- tablas nuevas en el mismo proyecto de Supabase de
-- Monitor LaLiga (reutilizado a propósito, ver CLAUDE.md). Prefijo dota_
-- para no chocar con las tablas de fútbol que ya existen ahí.

create table if not exists dota_teams (
  team_id bigint primary key,
  nombre text not null
);

-- series_id es el id del FIXTURE de dota.haglund.dev (ej. "mfiWqjJT5B:0003"),
-- NO el series_id numérico de OpenDota -- ese no existe todavía en el
-- momento de predecir (la serie no se ha jugado). Ver CLAUDE.md.
create table if not exists dota_series (
  series_id text primary key,
  league_id bigint,
  league_name text not null,
  formato text not null,
  equipo_a bigint not null references dota_teams(team_id),
  equipo_b bigint not null references dota_teams(team_id),
  start_time timestamptz not null,
  terminada boolean not null default false,
  victorias_a int,
  victorias_b int
);

create table if not exists dota_predictions (
  series_id text primary key references dota_series(series_id),
  prob_gana_a numeric not null,
  prob_empate numeric not null,
  prob_gana_b numeric not null,
  creada_en timestamptz not null default now(),
  resultado_real text,
  brier numeric
);

alter table dota_teams enable row level security;
alter table dota_series enable row level security;
alter table dota_predictions enable row level security;

create policy "lectura publica dota_teams" on dota_teams for select using (true);
create policy "lectura publica dota_series" on dota_series for select using (true);
create policy "lectura publica dota_predictions" on dota_predictions for select using (true);

-- RLS no basta -- Supabase no otorga GRANT en tablas creadas por SQL
-- Editor (gotcha real encontrado en Monitor LaLiga, ver su CLAUDE.md).
grant select on dota_teams, dota_series, dota_predictions to anon;
grant select, insert, update, delete on dota_teams, dota_series, dota_predictions to service_role;
