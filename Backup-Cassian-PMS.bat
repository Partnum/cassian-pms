@echo off
title Cassian PMS - Backup (Hifadhi nakala)
cd /d "%~dp0"
echo ============================================================
echo    CASSIAN PMS - HIFADHI NAKALA YA DATA
echo.
echo    Inanakili database yote (data ya pglite) kwenye folda
echo    "backups" ikiwa na tarehe/saa. Endesha mara kwa mara.
echo ============================================================
echo.
if not exist data\pglite (
  echo Hakuna data ya kuhifadhi bado. Endesha mfumo kwanza ^(Anza-Cassian-PMS.bat^).
  pause
  exit /b
)
if not exist backups mkdir backups
powershell -NoProfile -Command "$ts=Get-Date -Format 'yyyyMMdd-HHmmss'; $dest=Join-Path 'backups' ('pglite-'+$ts); Copy-Item -Recurse -Force 'data\pglite' $dest; Write-Host ('Nakala imehifadhiwa: '+$dest)"
echo.
echo ============================================================
echo    IMEKAMILIKA. Nakala zako zipo kwenye folda "backups".
echo    Kurejesha nakala ya hivi karibuni: bofya
echo        Rejesha-nakala-Cassian-PMS.bat
echo ============================================================
pause
