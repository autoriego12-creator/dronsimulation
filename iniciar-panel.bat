@echo off
chcp 65001 >nul
title HELIOS-KDE · Centro de Mando (ID 4300)
cd /d "%~dp0"

if not exist "frontend\dist\index.html" (
  echo Compilando el panel web por primera vez...
  call npm --prefix frontend install
  call npm --prefix frontend run build
)

echo.
echo  HELIOS-KDE en marcha:  http://localhost:8000
echo  Para cerrar, cierra esta ventana.
echo.
start "" /b cmd /c "timeout /t 3 >nul && start http://localhost:8000"
python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
pause
