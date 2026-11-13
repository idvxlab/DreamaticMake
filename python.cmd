@echo off
setlocal
set "PIP_CACHE_DIR=%~dp0.runtime\cache\pip"
if not exist "%~dp0.runtime\python\Scripts\python.exe" (
  echo Missing .runtime\python. See README.md for runtime setup. 1>&2
  exit /b 1
)
"%~dp0.runtime\python\Scripts\python.exe" %*
exit /b %errorlevel%
