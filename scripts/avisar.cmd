@echo off
REM Manda a Discord las predicciones nuevas y los resultados recien
REM calificados. No repite: lleva registro en salida/avisados.json de lo que
REM ya aviso, y solo marca como avisado lo que de verdad se envio.
REM
REM Necesita DISCORD_WEBHOOK en .env. Sin eso no revienta: lo dice en el log
REM y no manda nada. Ver n8n/README.md.

cd /d "D:\monitor-dota2"
echo [%date% %time%] --- avisar --- >> "scripts\log-avisar.txt"
node --env-file=.env "salida\discord.mjs" >> "scripts\log-avisar.txt" 2>&1
echo [%date% %time%] fin, codigo de salida %errorlevel% >> "scripts\log-avisar.txt"
exit /b %errorlevel%
