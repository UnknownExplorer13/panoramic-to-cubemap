@echo off
cd %~dp0
echo Use CTRL+C to close server when done.
echo.
start http://localhost:8000/ & python -m http.server 8000