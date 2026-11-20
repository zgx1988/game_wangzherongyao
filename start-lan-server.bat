@echo off
chcp 65001 >nul
title 荣耀峡谷 5v5 · 局域网联机服务器
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo [1/2] 正在构建网页前端...
  call npm run build
)
if not exist "server\dist-server.mjs" (
  echo [2/2] 正在构建局域网联机服务端...
  call npm run build:server
)
start "" "http://127.0.0.1:3000"
node server/dist-server.mjs
pause
