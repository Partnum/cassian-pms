@echo off
title Cassian PMS - Rekebisha data (Reset)
cd /d "%~dp0"
echo ============================================================
echo    CASSIAN PMS - REKEBISHA DATA (RESET)
echo.
echo    Hii inafuta database ya ndani (data ya pglite) na
echo    kuijenga upya na data ya mfano. Tumia pale dashboard
echo    inapoonyesha sufuri (database tupu).
echo ============================================================
echo.
echo Hatua 1/3 - Inafuta data ya zamani...
if exist data rmdir /s /q data
echo Hatua 2/3 - Inasakinisha vifurushi (kama vinakosekana)...
call npm install
echo.
echo Hatua 3/3 - Inajenga jedwali + data ya mfano...
call npm run migrate
call npm run seed
echo.
echo ============================================================
echo    Kama umeona "Seed complete." hapo juu, IMEFANIKIWA.
echo    Sasa funga dirisha hili na ubofye: Anza-Cassian-PMS.bat
echo    Kama umeona "Seed failed", nakili ujumbe wa kosa unipe.
echo ============================================================
pause
