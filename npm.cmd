@echo off
setlocal
set "PATH=%~dp0.runtime\node;%PATH%"
set "npm_config_cache=%~dp0.runtime\cache\npm"
if not exist "%~dp0.runtime\node\node.exe" (
  echo Missing .runtime\node\node.exe. See README.md for runtime setup. 1>&2
  exit /b 1
)
if not exist "%~dp0.runtime\npm\bin\npm-cli.js" (
  echo Missing .runtime\npm. See README.md for runtime setup. 1>&2
  exit /b 1
)
"%~dp0.runtime\node\node.exe" "%~dp0.runtime\npm\bin\npm-cli.js" %*
exit /b %errorlevel%
