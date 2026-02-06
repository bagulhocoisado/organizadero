@echo off
chcp 65001 > nul

cls
echo ============================================
echo   TESTE DO TOKEN
echo ============================================
echo.

if not exist ".github-token" (
    echo ERRO: Arquivo .github-token não existe!
    echo.
    dir /b .github*
    echo.
    pause
    exit /b
)

echo Arquivo .github-token encontrado!
echo.

set /p TOKEN=<.github-token

if "%TOKEN%"=="" (
    echo ERRO: Token está vazio!
    pause
    exit /b
)

echo Token lido com sucesso!
echo Primeiros 20 caracteres: %TOKEN:~0,20%...
echo.
echo Token está OK! Pode usar o publish.bat
echo.
pause