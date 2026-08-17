-- Torneo de cada predicción, para poder mostrarlo en el panel.
--
-- Se guarda el ID, no el nombre: los nombres se resuelven al pintar, con
-- nombresDeTorneos() de datos/juegos/bo3.mjs. Guardar el nombre lo congelaría
-- y duplicaría el dato; el id es estable y la resolución es una sola petición
-- por juego.
--
-- OJO al resolverlo: /tournaments está acotado por disciplina igual que
-- /teams y /matches. Sin el filtro devuelve sólo los de CS2 y el resto
-- desaparece sin error.

alter table eslo_predicciones
  add column if not exists torneo_id bigint;
