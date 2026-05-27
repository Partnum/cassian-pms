@echo off
title Cassian PMS
cd /d "%~dp0"
echo ============================================================
echo    CASSIAN PMS
echo.
echo    Mfumo unaanzishwa... kivinjari kitafunguka chenyewe.
echo    Kama hakijafunguka, fungua kivinjari kwenye:
echo         http://localhost:4000/login.html
echo.
echo    ACHA dirisha hili wazi unapotumia mfumo.
echo    Kuzima mfumo: funga dirisha hili.
echo ============================================================
echo.
start "" /min powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:4000/login.html'"
call npm start
echo.
echo Mfumo umesimama. Bonyeza kitufe chochote kufunga dirisha.
pause >nul
