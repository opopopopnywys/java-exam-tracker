@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   Java二级备考 App · 本地服务器
echo ============================================
echo.
echo  浏览器访问: http://localhost:8090/index.html
echo  关闭本窗口 = 关闭服务器
echo  按 Ctrl+C 也可停止服务器
echo.
echo --------------------------------------------
echo  正在启动...
echo --------------------------------------------
python -m http.server 8090
pause
