@echo off
REM Cruza las predicciones pendientes contra resultados reales de OpenDota,
REM calcula el Brier y actualiza Supabase. Pensado para el Programador de
REM tareas de Windows, como alternativa a n8n (ver n8n/README.md).
REM
REM Deja rastro en scripts\log-calificar.txt para poder auditar despues.

cd /d "D:\monitor-dota2"
echo [%date% %time%] --- calificar --- >> "scripts\log-calificar.txt"
node --env-file=.env juez\vivo-notas.mjs >> "scripts\log-calificar.txt" 2>&1
echo [%date% %time%] fin, codigo de salida %errorlevel% >> "scripts\log-calificar.txt"
exit /b %errorlevel%
