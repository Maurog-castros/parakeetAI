@echo off
setlocal
title ParakeetAI
cd /d "%~dp0"

set "ELECTRON_RUN_AS_NODE="

where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js no esta instalado o no esta disponible en PATH.
  echo Instala Node.js y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm no esta disponible en PATH.
  pause
  exit /b 1
)

echo Actualizando dependencias de ParakeetAI...
call npm.cmd install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo ERROR: No se pudieron instalar las dependencias.
  pause
  exit /b 1
)

echo Iniciando ParakeetAI desde %CD%...
call npm.cmd start
if errorlevel 1 (
  echo.
  echo ERROR: ParakeetAI termino con un error.
  pause
  exit /b 1
)

endlocal
