@echo off
REM Predice las series de TI2026 que todavia no empezaron y las guarda en
REM Supabase. Pensado para el Programador de tareas de Windows, como
REM alternativa a n8n (que trae executeCommand deshabilitado por defecto --
REM ver n8n/README.md).
REM
REM Deja rastro en scripts\log-predecir.txt para poder auditar despues.

cd /d "D:\monitor-dota2"
echo [%date% %time%] --- predecir --- >> "scripts\log-predecir.txt"
node --env-file=.env juez\vivo-motor.mjs >> "scripts\log-predecir.txt" 2>&1
echo [%date% %time%] fin, codigo de salida %errorlevel% >> "scripts\log-predecir.txt"
exit /b %errorlevel%
