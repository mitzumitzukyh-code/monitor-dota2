# Logos de los juegos

Uno por juego, con el nombre de la clave del juego:

```
dota2  lol  valorant  cs2
```

**Para cambiar uno**, pon el archivo acá con ese nombre y vuelve a generar:

```
node --env-file=.env salida/web/dashboard.mjs
node --env-file=.env salida/web/generar.mjs
```

No hay que tocar código.

## Formatos

Se prueban en este orden y **gana el primero que exista**:

```
.svg  .png  .webp  .jpg  .jpeg
```

Ojo con eso: si dejas `dota2.png` al lado de `dota2.svg`, **sigue mandando el
SVG**. Hay que borrar el que ya no se quiere.

El SVG va primero a propósito: escala sin pixelarse y suele pesar menos. Los
logos se **incrustan** en el HTML como data URI, así que su peso se paga en
cada página: un PNG de 500×500 puede costar 100 KB para dibujarse a 26 px.
Si vas a usar PNG, redúcelo antes a ~128 px de lado.

## Se dibujan chiquitos

En el panel salen a **26 px** (tablas), **38 px** (filas por juego) y **28 px**
(barra lateral). A ese tamaño **un logo con el nombre escrito debajo no se
lee**: el texto queda en dos o tres píxeles de alto y sólo ensucia. Para esto
sirve el emblema solo —el cuadrado rojo de Dota, la V de Valorant, la L de
League— no el lockup completo.

Si el archivo trae el nombre, el panel lo va a mostrar igual; simplemente no se
va a entender.

## Fondo

Cada logo va sobre una **placa clara** (`#e9edf3`), porque varios oficiales
están pensados para fondo blanco y el de CS2 es casi negro (`#1E202F`): sobre
el panel oscuro desaparecía. Un logo blanco sin borde se va a perder sobre esa
placa.

Los escudos de EQUIPO son al revés (placa oscura), porque los de esports están
hechos para fondo oscuro y muchos son blancos.

## Lo que hay ahora

Los cuatro salieron de Wikimedia Commons el 2026-08-18. Pesan entre 900 B y
7 KB.
