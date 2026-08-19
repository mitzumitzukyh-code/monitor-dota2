# Assets · MONITOR-ESPORTS

Paquete de marca + tarjeta social para el panel. Todo generado a partir de los colores
y la tipografia que ya usa el sitio (`--blue #2563eb`, `--violet #7c3aed`, `--bg #05080c`, Inter).

## Como instalarlo

1. Copia esta carpeta completa a la raiz del proyecto, que quede `/assets/...`
   (si la sirves desde otra ruta, ajusta las rutas del snippet y del manifest).
2. Abre `head-snippet.html`, cambia `https://TU-DOMINIO` por tu dominio real y pega
   el bloque en el `<head>` de `index.html` y de `dota.html`, justo despues del `<title>`.
3. En `dota.html` ademas cambia `og:title`, `og:url` y `og:image` por la version de Dota
   (las tres lineas comentadas al final del snippet).

> Ojo: `og:image` tiene que ser URL absoluta con `https://`. Con ruta relativa
> WhatsApp, X, Discord y Telegram no muestran nada.

## Que trae

| Archivo | Para que |
|---|---|
| `favicon.svg` | Favicon moderno, vectorial, pesa 442 B. Lo usan Chrome/Firefox/Edge. |
| `favicon.ico` | Fallback (16/32/48) para navegadores viejos y para el historial. |
| `favicon-16.png`, `favicon-32.png` | PNG sueltos por si los necesitas aparte. |
| `apple-touch-icon.png` (180) | Icono al guardar en pantalla de inicio en iOS. Va a sangre (sin esquinas redondeadas) porque iOS aplica su propia mascara. |
| `icon-192.png`, `icon-512.png` | Iconos PWA / Android. |
| `icon-maskable-512.png` | Version maskable (contenido dentro de la zona segura del 80%) para que Android no te recorte el rayo. |
| `site.webmanifest` | Manifest con nombre, colores y los iconos de arriba. |
| `og-image.png` (1200x630) | Tarjeta social del panel. |
| `og-image-dota.png` (1200x630) | Tarjeta social de la pagina de Dota. |
| `logo-mark.svg` | Marca completa con el arco (usar de 64 px para arriba). |
| `logo-mark-simple.svg` | Marca sin arco, para tamanos chicos. |
| `logo-mark-fullbleed.svg` | Marca a sangre, sin esquinas redondeadas. |
| `logo-mark-maskable.svg` | Fuente del icono maskable. |
| `logo-mark-mono.svg` | Un solo color (usa `currentColor`), para watermark, impresion o fondos raros. |
| `logo-horizontal.svg` | Lockup horizontal para fondo oscuro. Texto en curvas: no depende de que Inter este instalada. |
| `logo-horizontal-light.svg` | Lockup horizontal para fondo claro. |

## Usar el logo en el sidebar

Hoy el sidebar arma la marca con un SVG inline. Si quieres unificarlo con el archivo:

```html
<div class="brand">
  <img src="/assets/logo-horizontal.svg" alt="MONITOR-ESPORTS" height="40">
</div>
```

O, si prefieres mantener el texto en HTML (mejor para SEO y para seleccionar/copiar),
deja el texto como esta y cambia solo el cuadrito:

```html
<img class="brand-icon" src="/assets/logo-mark-simple.svg" alt="" width="36" height="36">
```

## Reglas de marca

- Espacio libre alrededor del logo: minimo la mitad del ancho del cuadrito.
- Tamano minimo del lockup horizontal: 120 px de ancho. Por debajo de eso, usa solo la marca.
- El gradiente siempre va a 135 grados, azul arriba-izquierda y violeta abajo-derecha. No lo inviertas.
- El rayo siempre blanco puro. No lo pintes de otro color ni lo pongas sobre fondo claro sin el cuadrito.
- Sobre fondos claros usa `logo-horizontal-light.svg`, nunca el oscuro con opacidad.

## Colores (los mismos del CSS)

```
--blue    #2563eb    gradiente inicio
--violet  #7c3aed    gradiente fin
--accent  #3b82f6    "ESPORTS", enlaces
--bg      #05080c    fondo
--card    #0c141d    tarjetas
--border  #1b2634    bordes
--text    #e5eaf1    texto
--mut     #94a0b0    texto secundario
--green   #22c55e    acerto
--red     #ef4444    fallo
--yellow  #f59e0b    aviso de muestra
```
