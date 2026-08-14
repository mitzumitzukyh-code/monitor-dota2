-- Mueve el registro de "qué ya se avisó" de un archivo en disco
-- (salida/avisados.json) a Supabase.
--
-- Por qué: al pasar a GitHub Actions no hay disco que persista entre
-- corridas. El archivo se perdería cada vez y Discord mandaría los mismos
-- avisos cada hora.
--
-- Dos columnas separadas porque son dos avisos distintos sobre la misma
-- serie: primero se avisa la predicción (antes de jugarse) y después el
-- resultado (cuando se califica). Una sola columna no podría distinguirlos.

alter table dota_predictions
  add column if not exists avisado_prediccion_en timestamptz,
  add column if not exists avisado_resultado_en timestamptz;

-- Las 8 series de hoy ya se avisaron por Discord desde el disco local: se
-- marcan para que la primera corrida en Actions no las repita.
update dota_predictions
   set avisado_prediccion_en = now()
 where avisado_prediccion_en is null;

update dota_predictions
   set avisado_resultado_en = now()
 where resultado_real is not null
   and avisado_resultado_en is null;
