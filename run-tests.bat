@echo off
setlocal
cd /d "%~dp0"
echo Dafeiyu Plus automated tests
echo Project: %CD%
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-tests.ps1"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo ALL TESTS PASSED.
) else (
  echo SOME TESTS FAILED OR WERE SKIPPED.
  echo Review the log path printed above.
)
echo.
pause
exit /b %RC%
