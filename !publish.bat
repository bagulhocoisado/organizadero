@echo off
chcp 65001 >nul

REM Força o script a rodar no diretório onde ele está
cd /d "%~dp0"

REM ================================
REM CONFIGURAÇÃO
REM ================================
REM 🔑 COLE SEU TOKEN AQUI
set "GH_TOKEN=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"
REM ================================

echo ============================================
echo   PUBLICAR NOVA VERSÃO NO GITHUB
echo   Organizador de Contas
echo ============================================
echo.

REM Verificar Git
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Git não instalado!
    echo Baixe em: https://git-scm.com/download/win
    pause
    exit /b 1
)

echo [1/7] Verificando node_modules...
if not exist "node_modules" (
    echo [INFO] Instalando dependências...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao instalar dependências
        pause
        exit /b 1
    )
) else (
    echo [OK] Dependências já instaladas
)

echo.
echo [2/7] Verificando repositório Git...
if not exist ".git" (
    echo [INFO] Configurando Git pela primeira vez...
    git init
    git branch -M main
    git remote add origin https://github.com/bagulhocoisado/organizadero.git
) else (
    echo [OK] Repositório já configurado
)

echo.
echo [3/7] Adicionando arquivos...
git add .

echo.
echo [4/7] Criando commit...
set /p commit_msg="Mensagem do commit (Enter = 'Nova versão'): "
if "%commit_msg%"=="" set commit_msg=Nova versão

git commit -m "%commit_msg%"
if %errorlevel% neq 0 (
    echo [INFO] Nenhuma mudança para commitar
)

echo.
echo [5/7] Enviando para GitHub...
git push origin main
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao enviar para o GitHub
    pause
    exit /b 1
)

echo.
echo [6/7] Criando tag de versão...
set /p version="Digite a versão (ex: 1.0.1): "
if "%version%"=="" (
    echo [ERRO] Versão é obrigatória!
    pause
    exit /b 1
)

git tag "v%version%"
git push origin "v%version%"

echo.
echo [7/7] Compilando e publicando release...
echo [AVISO] Isso vai criar o release no GitHub!
echo.
set /p confirm="Confirma? (S/N): "
if /i not "%confirm%"=="S" (
    echo Operação cancelada
    pause
    exit /b 0
)

echo.
echo [INFO] Publicando com GitHub Token...
call npm run publish

if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo   SUCESSO! 🎉
    echo   Versão %version% publicada!
    echo ============================================
    echo.
    echo https://github.com/bagulhocoisado/organizadero/releases
) else (
    echo.
    echo ============================================
    echo   ERRO AO PUBLICAR
    echo ============================================
    echo.
    echo Verifique:
    echo 1. Token está correto?
    echo 2. Permissões no repositório?
    echo 3. Tag já existe?
)

pause