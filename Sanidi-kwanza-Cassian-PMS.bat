@echo off
title Cassian PMS - Maandalizi
cd /d "%~dp0"
echo ============================================================
echo    CASSIAN PMS - Maandalizi (endesha mara ya kwanza tu,
echo    au pale unapotaka kurudisha data ya mfano upya)
echo ============================================================
echo.
echo Hatua 1/2 - Inasakinisha vifurushi (npm install)...
call npm install
echo.
echo Hatua 2/2 - Inaandaa database na data ya mfano (npm run setup)...
call npm run setup
echo.
echo ============================================================
echo    Imekamilika! Sasa bofya mara mbili faili:
echo        Anza-Cassian-PMS.bat
echo ============================================================
pause
