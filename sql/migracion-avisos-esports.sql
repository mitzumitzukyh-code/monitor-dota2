-- Avisos de Discord para los juegos de bo3.gg.
--
-- tier: se guarda al predecir para poder filtrar QUÉ se anuncia. CS2 mueve
-- ~34 partidas al día contando todos los tiers; anunciarlas todas es ruido
-- que nadie lee. Se sigue prediciendo y calificando todo (sirve para medir el
-- motor), pero sólo se avisa de los tiers s y a.
--
-- avisado_*: mismo criterio que en las tablas dota_*. El estado de "esto ya se
-- avisó" vive en la base y no en disco, porque GitHub Actions no conserva
-- archivos entre corridas.

alter table eslo_predicciones
  add column if not exists tier                   text,
  add column if not exists avisado_prediccion_en  timestamptz,
  add column if not exists avisado_resultado_en   timestamptz;
