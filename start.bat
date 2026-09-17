@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul && (py -3 sec_server.py) || (python sec_server.py)
pause
