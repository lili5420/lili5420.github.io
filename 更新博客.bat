@echo off
chcp 65001 >nul
title 更新博客
cd /d "%~dp0"

echo ============================================
echo   1/3  正在生成网站...
echo ============================================
node build.mjs
if errorlevel 1 (
  echo.
  echo [失败] 构建出错，把上面的信息截图发给助手。
  pause
  exit /b 1
)

echo.
echo ============================================
echo   2/3  正在提交改动...
echo ============================================
git add -A
git commit -m "更新博客 %date% %time%"
if errorlevel 1 (
  echo.
  echo [提示] 没有新的改动，跳过提交。
)

echo.
echo ============================================
echo   3/3  正在推送到 GitHub...
echo ============================================
git push
if errorlevel 1 (
  echo.
  echo [失败] 推送失败。可能是本地落后于远端，先在命令行执行 git pull 再试。
  pause
  exit /b 1
)

echo.
echo ============================================
echo   [成功] 已推送
echo   约 1 分钟后刷新：https://lili5420.github.io
echo ============================================
pause
