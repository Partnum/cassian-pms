@echo off
title Cassian PMS - Rejesha nakala (Restore)
cd /d "%~dp0"
echo ============================================================
echo    CASSIAN PMS - REJESHA NAKALA YA HIVI KARIBUNI
echo.
echo    ONYO: Hii inafuta data ya sasa na kurudisha nakala ya
echo    mwisho kutoka folda "backups".
echo    HAKIKISHA server imezimwa kwanza (funga dirisha la Anza).
echo ============================================================
echo.
set /p ok=Andika NDIYO kuendelea (au funga dirisha kughairi):
if /I not "%ok%"=="NDIYO" (
  echo Imeghairiwa.
  pause
  exit /b
)
powershell -NoProfile -Command "$b=Get-ChildItem 'backups' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1; if(-not $b){Write-Host 'Hakuna nakala kwenye folda backups.'; exit}; Write-Host ('Inarejesha kutoka: '+$b.Name); if(Test-Path 'data\pglite'){Remove-Item -Recurse -Force 'data\pglite'}; if(-not(Test-Path 'data')){New-Item -ItemType Directory 'data' | Out-Null}; Copy-Item -Recurse -Force $b.FullName 'data\pglite'; Write-Host 'Imerejeshwa kikamilifu.'"
echo.
echo Imekamilika. Sasa washa mfumo: Anza-Cassian-PMS.bat
pause
