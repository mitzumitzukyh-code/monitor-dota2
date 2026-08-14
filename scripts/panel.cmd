@echo off
REM Regenera el panel web (salida/web/index.html) con lo ultimo que haya en
REM Supabase. Corre despues de predecir (:05) y calificar (:35), asi el
REM panel siempre refleja el estado real. Ver n8n/README.md.

cd /d "D:\monitor-dota2"
echo [%date% %time%] --- panel --- >> "scripts\log-panel.txt"
node --env-file=.env "salida\web\generar.mjs" >> "scripts\log-panel.txt" 2>&1
echo [%date% %time%] fin, codigo de salida %errorlevel% >> "scripts\log-panel.txt"
exit /b %errorlevel%
