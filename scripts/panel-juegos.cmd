@echo off
REM Regenera las paginas por juego de CS2, LoL y Valorant
REM (salida/web/cs2.html, lol.html, valorant.html) y sus fichas por partida,
REM con lo ultimo que haya en Supabase (tablas eslo_*).
REM Los numeros ya estan guardados: esto solo los pinta, no recalcula nada.

cd /d "D:\monitor-dota2"
echo [%date% %time%] --- panel por juego --- >> "scripts\log-panel-juegos.txt"
node --env-file=.env "salida\web\juego.mjs" cs2 lol valorant >> "scripts\log-panel-juegos.txt" 2>&1
echo [%date% %time%] fin, codigo de salida %errorlevel% >> "scripts\log-panel-juegos.txt"
exit /b %errorlevel%