// Servidor estático mínimo para ver el panel en el navegador. Solo para
// mirar el resultado en local -- el panel es un HTML estático, no necesita
// servidor para funcionar (se abre con doble click igual).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const PUERTO = Number(process.env.PUERTO) || 4321;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

createServer(async (req, res) => {
  const ruta = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const datos = await readFile(new URL('.' + ruta, import.meta.url));
    res.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] ?? 'application/octet-stream' });
    res.end(datos);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('no existe: ' + ruta);
  }
}).listen(PUERTO, '127.0.0.1', () => {
  console.log('panel en http://127.0.0.1:' + PUERTO);
});
