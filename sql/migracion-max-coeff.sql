-- La MEJOR cuota entre casas, no la del proveedor que trae bet_updates.
--
-- Por qué importa: `coeff` viene de 1xbit (bet_provider_id 39), una casa de
-- cripto y por tanto blanda. Ganarle a una casa blanda prueba poco -- tienen
-- márgenes gordos y líneas lentas justamente porque no compiten en precisión.
-- `max_coeff` es el mejor precio disponible en el mercado, y ganarle a eso sí
-- significa algo.
--
-- Se intentó primero el proveedor id=5 ("Average") de bo3.gg: el filtro
-- bet_provider_id responde 200 pero devuelve las mismas cuotas del 39, o sea
-- que es inerte. No hay endpoint de odds separado (/odds, /bet_odds,
-- /matches/{id}/odds devuelven 404). max_coeff es lo mejor accesible.
--
-- OJO con margen_max: puede ser NEGATIVO. Tomar el mejor precio de los dos
-- lados puede sumar menos de 1 (arbitraje teórico entre casas). No es un
-- error de cálculo: es que ninguna casa sola ofrece ese par de precios.

alter table eslo_cuotas
  add column if not exists max_coeff_a numeric,
  add column if not exists max_coeff_b numeric,
  add column if not exists prob_max_a  numeric,
  add column if not exists prob_max_b  numeric,
  add column if not exists margen_max  numeric;
