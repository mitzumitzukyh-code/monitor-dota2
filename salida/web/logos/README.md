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

Sirven `.svg`, `.png`, `.webp`, `.jpg` y `.jpeg`. Si hay varios con el mismo
nombre y distinta extensión, **gana el más reciente**: sueltas `dota2.png`
encima y manda ése aunque siga estando el `dota2.svg` viejo. No hace falta
borrar nada, aunque tenerlo limpio no estorba.

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

## Cuánto deben pesar

Los logos se incrustan en el CSS de cada página, **una sola vez por documento**
(regla `.lg-dota2`, ver `logo()` en `estilo.mjs`). Antes iban como
`<img src="data:...">` y se repetían en cada fila: al cambiar los SVG por PNG,
`index.html` saltó de 173 KB a **1,58 MB**. Puestos en el CSS volvió a 173 KB.

Aun así conviene que sean chicos. Los de ahora están a **128 px de lado** y
pesan entre 5 y 36 KB. Los originales pesaban 471 KB entre los cuatro; se
redujeron antes de meterlos.

Para reducir uno nuevo en Windows, sin instalar nada:

```powershell
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile("C:uta\logo-grande.png")
$r = [Math]::Min(128 / $src.Width, 128 / $src.Height)
$w = [int][Math]::Round($src.Width * $r); $h = [int][Math]::Round($src.Height * $r)
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($src, 0, 0, $w, $h)
$bmp.Save("D:\monitor-dota2\salida\web\logos\dota2.png", [System.Drawing.Imaging.ImageFormat]::Png)
```

## Lo que hay ahora

Los cuatro oficiales que puso el dueño el 2026-08-19, reducidos a 128 px.
Antes eran SVG de Wikimedia Commons.
