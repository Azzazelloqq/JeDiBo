@echo off
chcp 65001 >nul
title JeDiBo
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите его с https://nodejs.org ^(версия 18+^) и запустите снова.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Первый запуск: устанавливаю зависимости...
  call npm install
  if errorlevel 1 (
    echo Не удалось установить зависимости.
    pause
    exit /b 1
  )
)

echo Запускаю JeDiBo на http://localhost:5173 ^(закройте окно, чтобы остановить^)
call npm run dev -- --open
pause
