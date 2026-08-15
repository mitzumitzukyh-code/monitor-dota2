-- Resumen de cierre de jornada (Discord).
--
-- Misma idea que avisado_prediccion_en / avisado_resultado_en: el estado de
-- "esto ya se avisó" vive en la base, no en disco, porque GitHub Actions no
-- conserva archivos entre corridas (ver migracion-avisos.sql).
--
-- Se marca en TODAS las series de la jornada resumida, no en una sola: así
-- jornadaParaResumir() puede preguntar "¿queda alguna sin marcar?" sin tener
-- que guardar aparte qué es una jornada.

alter table dota_predictions
  add column if not exists avisado_resumen_en timestamptz;
