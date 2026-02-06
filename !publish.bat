@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

REM ============================================
REM Forçar execução no diretório do script
REM ============================================
cd /d "%~dp0"

REM ============================================
REM Verificar token
REM ============================================
if not exist ".github-token" (
    echo [ERRO] Arquivo .github-token não encontrado!
    echo Crie um arquivo chamado .github-token com seu token dentro.
    pause
    exit /b 1
)

set /p GH_TOKEN=<.github-token
if "%GH_TOKEN%"=="" (
    echo [ERRO] Token vazio no arquivo .github-token
    pause
    exit /b 1
)

set GH_TOKEN=%GH_TOKEN%

REM ============================================
REM Banner
REM ============================================
echo ============================================
echo   PUBLICAR NOVA VERSÃO NO GITHUB
echo ============================================
echo.

REM ============================================
REM Verificar Git
REM ============================================
git --version >nul 2>&1 || (
    echo [ERRO] Git não instalado
    pause
    exit /b 1
)

REM ============================================
REM Instalar dependências se necessário
REM ============================================
if not exist "node_modules" (
    echo [INFO] Instalando dependências...
    call npm install || exit /b 1
)

REM ============================================
REM Configurar Git se necessário
REM ============================================
if not exist ".git" (
    git init || exit /b 1
    git branch -M main
    git remote add origin https://github.com/bagulhocoisado/organizadero.git
)

REM ============================================
REM Commit automático (se houver mudanças)
REM ============================================
git add .

git diff --cached --quiet
if %errorlevel% neq 0 (
    git commit -m "build: auto publish" || exit /b 1
) else (
    echo [INFO] Nenhuma mudança para commit
)

REM ============================================
REM Push
REM ============================================
git push origin main || exit /b 1

REM ============================================
REM Definir versão automaticamente (patch++)
REM ============================================
for /f %%v in ('git tag --list "v*" --sort=-v:refname') do (
    set LAST_TAG=%%v
    goto :tag_found
)

:tag_found
if not defined LAST_TAG (
    set VERSION=1.0.0
) else (
    for /f "tokens=1-3 delims=." %%a in ("%LAST_TAG:v=%") do (
        set /a PATCH=%%c+1
        set VERSION=%%a.%%b.!PATCH!
    )
)

echo [INFO] Nova versão: v%VERSION%

REM ============================================
REM Criar e enviar tag
REM ============================================
git tag v%VERSION% || exit /b 1
git push origin v%VERSION% || exit /b 1

REM ============================================
REM Confirmação final
REM ============================================
echo.
echo ============================================
echo Versão v%VERSION% pronta para upload
echo ============================================
set /p CONFIRM="Confirmar upload do release? (S/N): "

if /I not "%CONFIRM%"=="S" (
    echo Upload cancelado
    exit /b 0
)

REM ============================================
REM Publicar release
REM ============================================
call npm run publish

if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo   SUCESSO! Release v%VERSION% publicado.
    echo ============================================
    echo https://github.com/bagulhocoisado/organizadero/releases
) else (
    echo.
    echo ============================================
    echo   ERRO AO PUBLICAR RELEASE
    echo ============================================
)

pause