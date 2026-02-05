const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Importar electron-updater com segurança
let autoUpdater = null;
let autoUpdaterAvailable = false;

try {
  if (app.isPackaged) {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdaterAvailable = true;
    console.log('[AutoUpdater] Módulo carregado com sucesso');
  } else {
    console.log('[AutoUpdater] Desabilitado em modo desenvolvimento');
  }
} catch (err) {
  console.error('[AutoUpdater] Não foi possível carregar o módulo:', err.message);
  console.log('[AutoUpdater] O app funcionará normalmente sem auto-update');
}

// Proteção contra múltiplas instâncias
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[App] Outra instância já está rodando, fechando...');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Alguém tentou abrir uma segunda instância, focar na janela existente
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Suprimir erros SSL no console
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('log-level', '3');

// Filtrar erros SSL do console
const originalConsoleError = console.error;
console.error = (...args) => {
  const errorStr = args.join(' ');
  if (errorStr.includes('ssl_client_socket_impl.cc') || 
      errorStr.includes('handshake failed') ||
      errorStr.includes('net_error -100')) {
    return;
  }
  originalConsoleError.apply(console, args);
};

// ========== CONFIGURAÇÃO DO AUTO-UPDATER ==========
// Sistema totalmente automático e silencioso
let isDownloadingUpdate = false;
let updateDownloaded = false;
let updateCheckInProgress = false;

if (autoUpdaterAvailable && autoUpdater) {
  // Configurar para GitHub Releases
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'bagulhocoisado',
    repo: 'organizadero',
    private: false
  });

  // Configurações para update automático e silencioso
  autoUpdater.autoDownload = true; // Download automático em background
  autoUpdater.autoInstallOnAppQuit = true; // Instalar automaticamente ao fechar
  autoUpdater.allowPrerelease = false; // Apenas releases estáveis
  autoUpdater.allowDowngrade = false; // Sem downgrade

  // Configurar logger
  try {
    const log = require('electron-log');
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';
    console.log('[AutoUpdater] Logger configurado');
  } catch (err) {
    console.log('[AutoUpdater] Usando console padrão para logs');
  }

  // Eventos do autoUpdater (todos silenciosos)
  autoUpdater.on('checking-for-update', () => {
    updateCheckInProgress = true;
    console.log('[AutoUpdater] 🔍 Verificando atualizações...');
    mainWindow?.webContents.send('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    updateCheckInProgress = false;
    isDownloadingUpdate = true;
    console.log('[AutoUpdater] ✅ Atualização disponível!');
    console.log(`[AutoUpdater] 📦 Nova versão: ${info.version}`);
    console.log(`[AutoUpdater] 💾 Tamanho: ${(info.files[0]?.size / 1024 / 1024).toFixed(2)} MB`);
    console.log('[AutoUpdater] ⏬ Download iniciando automaticamente...');
    
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      currentVersion: app.getVersion(),
      releaseDate: info.releaseDate,
      size: info.files[0]?.size
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    updateCheckInProgress = false;
    console.log('[AutoUpdater] ✓ Aplicativo está atualizado');
    console.log(`[AutoUpdater] 📌 Versão atual: ${app.getVersion()}`);
    
    mainWindow?.webContents.send('update-not-available', {
      version: app.getVersion()
    });
  });

  autoUpdater.on('error', (err) => {
    updateCheckInProgress = false;
    isDownloadingUpdate = false;
    console.error('[AutoUpdater] ❌ Erro:', err.message);
    
    // Enviar erro apenas para debug, não mostrar ao usuário
    mainWindow?.webContents.send('update-error', {
      message: err.message
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    const transferred = (progressObj.transferred / 1024 / 1024).toFixed(2);
    const total = (progressObj.total / 1024 / 1024).toFixed(2);
    const speed = (progressObj.bytesPerSecond / 1024 / 1024).toFixed(2);
    
    console.log(`[AutoUpdater] ⏬ Baixando: ${percent}% (${transferred}/${total} MB) @ ${speed} MB/s`);
    
    mainWindow?.webContents.send('update-download-progress', {
      percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
      bytesPerSecond: progressObj.bytesPerSecond
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    isDownloadingUpdate = false;
    updateDownloaded = true;
    console.log('[AutoUpdater] ✅ Atualização baixada com sucesso!');
    console.log(`[AutoUpdater] 🚀 Nova versão ${info.version} será instalada no próximo início`);
    console.log('[AutoUpdater] 💡 Feche e reabra o aplicativo para atualizar');
    
    mainWindow?.webContents.send('update-downloaded', {
      version: info.version,
      currentVersion: app.getVersion()
    });
  });
  
  console.log('[AutoUpdater] ✓ Sistema configurado (modo silencioso)');
  console.log(`[AutoUpdater] 📌 Versão atual: ${app.getVersion()}`);
} else {
  console.log('[AutoUpdater] ⚠ Não disponível (modo desenvolvimento)');
}
// ========== FIM DA CONFIGURAÇÃO DO AUTO-UPDATER ==========


let mainWindow;
let currentSavePath;
let savesDir;
let backupsDir;
let configPath;

function getSavesDirectory() {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'saves');
  } else {
    return path.join(app.getAppPath(), 'saves');
  }
}

function getBackupsDirectory() {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'saves', 'backups');
  } else {
    return path.join(app.getAppPath(), 'saves', 'backups');
  }
}

function getConfigPath() {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'saves', 'app-config.json');
  } else {
    return path.join(app.getAppPath(), 'saves', 'app-config.json');
  }
}

async function loadConfig() {
  try {
    const data = await fs.readFile(configPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return { currentSave: 'contas.json' };
  }
}

async function saveConfig(config) {
  try {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Erro ao salvar config:', err);
  }
}

async function ensureDirectories() {
  try {
    await fs.mkdir(savesDir, { recursive: true });
    await fs.mkdir(backupsDir, { recursive: true });
    
    // Migrar contas.json antigo se existir na raiz
    const oldSavePath = app.isPackaged 
      ? path.join(path.dirname(app.getPath('exe')), 'contas.json')
      : path.join(app.getAppPath(), 'contas.json');
    
    const newSavePath = path.join(savesDir, 'contas.json');
    
    try {
      await fs.access(oldSavePath);
      // Arquivo antigo existe, migrar
      await fs.rename(oldSavePath, newSavePath);
      console.log('Arquivo contas.json migrado para pasta saves/');
    } catch (err) {
      // Arquivo antigo não existe, ok
    }
    
    // Carregar configuração para determinar qual save usar
    const config = await loadConfig();
    currentSavePath = path.join(savesDir, config.currentSave || 'contas.json');
    
    // Criar save padrão se não existir
    try {
      await fs.access(currentSavePath);
    } catch (err) {
      // Arquivo não existe, criar um novo com template inicial
      const initialData = {
        sections: [
          {
            url: '',
            value: 0,
            number: '',
            returnDays: 5,
            color: '#52525b',
            collapsed: false,
            dateGroups: []
          },
          {
            url: '',
            value: 0,
            number: '',
            returnDays: 5,
            color: '#71717a',
            collapsed: false,
            dateGroups: []
          }
        ],
        folders: [],
        tabLayout: true,
        hideReturnsAbove: 1,
        hideHighlightedAbove: 6
      };
      await fs.writeFile(currentSavePath, JSON.stringify(initialData, null, 2), 'utf8');
      console.log('Arquivo de save criado automaticamente:', currentSavePath);
    }
  } catch (err) {
    console.error('Erro ao criar diretórios:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'icon.png'),
    frame: false,
    titleBarStyle: 'hidden'
  });

  mainWindow.loadFile('index.html');
  
  // Abre o DevTools em desenvolvimento
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  savesDir = getSavesDirectory();
  backupsDir = getBackupsDirectory();
  configPath = getConfigPath();
  await ensureDirectories();
  createWindow();
  
  // Verificar atualizações após 3 segundos (apenas em produção e se disponível)
  if (app.isPackaged && autoUpdaterAvailable && autoUpdater) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.error('[AutoUpdater] Erro ao verificar:', err.message);
      });
    }, 3000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Proteção contra perda de dados durante download de update
app.on('before-quit', async (event) => {
  if (isDownloadingUpdate && !updateDownloaded) {
    console.log('[AutoUpdater] Download em andamento, mas permitindo fechamento seguro');
    // O electron-updater lida com downloads interrompidos automaticamente
    // na próxima verificação, ele retoma ou reinicia o download
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

// Carregar dados do arquivo atual
ipcMain.handle('load-data', async () => {
  try {
    const data = await fs.readFile(currentSavePath, 'utf8');
    return { success: true, data: JSON.parse(data), path: currentSavePath };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { success: true, data: null, path: currentSavePath };
    }
    return { success: false, error: err.message };
  }
});

// Salvar dados no arquivo atual
ipcMain.handle('save-data', async (event, data) => {
  try {
    await fs.writeFile(currentSavePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true, path: currentSavePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Listar saves disponíveis
ipcMain.handle('list-saves', async () => {
  try {
    const normalFiles = await fs.readdir(savesDir);
    const backupFiles = await fs.readdir(backupsDir);
    
    const normalSaves = normalFiles.filter(f => f.endsWith('.json') && f !== 'app-config.json');
    const backupSaves = backupFiles.filter(f => f.endsWith('.json'));
    
    return { 
      success: true, 
      normal: normalSaves,
      backups: backupSaves
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Trocar para outro save
ipcMain.handle('switch-save', async (event, fileName) => {
  try {
    currentSavePath = path.join(savesDir, fileName);
    const data = await fs.readFile(currentSavePath, 'utf8');
    
    // Salvar preferência
    await saveConfig({ currentSave: fileName });
    
    return { success: true, data: JSON.parse(data), path: currentSavePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Restaurar backup
ipcMain.handle('restore-backup', async (event, fileName) => {
  try {
    const sourcePath = path.join(backupsDir, fileName);
    const today = new Date();
    const dateStr = `${String(today.getMonth() + 1).padStart(2, '0')}_${String(today.getDate()).padStart(2, '0')}_${today.getFullYear()}`;
    const baseName = fileName.replace('.json', '').replace(/^backup_\d+_\d+_\d+_\d+$/, 'backup');
    const newFileName = `${baseName}_${dateStr}.json`;
    const newPath = path.join(savesDir, newFileName);
    
    const data = await fs.readFile(sourcePath, 'utf8');
    await fs.writeFile(newPath, data, 'utf8');
    
    currentSavePath = newPath;
    
    // Salvar preferência
    await saveConfig({ currentSave: newFileName });
    
    return { success: true, data: JSON.parse(data), path: newPath, fileName: newFileName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


// Criar backup
ipcMain.handle('create-backup', async (event, fileName, data) => {
  try {
    const backupPath = path.join(backupsDir, fileName);
    await fs.writeFile(backupPath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
// Criar novo save
ipcMain.handle('create-save', async (event, fileName) => {
  try {
    const newSavePath = path.join(savesDir, fileName);
    const initialData = {
      sections: [
        {
          url: '',
          value: 0,
          number: '',
          returnDays: 5,
          color: '#52525b',
          collapsed: false,
          dateGroups: []
        },
        {
          url: '',
          value: 0,
          number: '',
          returnDays: 5,
          color: '#71717a',
          collapsed: false,
          dateGroups: []
        }
      ],
      folders: [],
      tabLayout: true,
      hideReturnsAbove: 1,
      hideHighlightedAbove: 6
    };
    await fs.writeFile(newSavePath, JSON.stringify(initialData, null, 2), 'utf8');
    return { success: true, path: newSavePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
// Restaurar foco da janela
ipcMain.handle('restore-focus', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    mainWindow.webContents.focus();
    return { success: true };
  }
  return { success: false };
});
// Abrir pasta de saves
ipcMain.handle('open-saves-folder', async () => {
  try {
    const { shell } = require('electron');
    await shell.openPath(savesDir);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
// Handler para resetar Machine GUID
ipcMain.handle('reset-machine-guid', async () => {
  try {
    const crypto = require('crypto');
    
    // Criar pasta de utilidades para backups
    const utilitiesDir = path.join(savesDir, 'utilidades');
    await fs.mkdir(utilitiesDir, { recursive: true });
    
    const backupPath = path.join(utilitiesDir, 'backup_machine_guid.txt');
    
    // Verificar se o backup já existe
    let needsBackup = false;
    try {
      await fs.access(backupPath);
      console.log('[Reset GUID] Backup já existe, pulando criação');
    } catch (err) {
      needsBackup = true;
    }
    
    // Criar backup do valor original se for a primeira vez
    if (needsBackup) {
      try {
        const { stdout } = await execAsync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid');
        const match = stdout.match(/MachineGuid\s+REG_SZ\s+(.+)/);
        if (match) {
          const originalGuid = match[1].trim();
          await fs.writeFile(backupPath, originalGuid, 'utf8');
          console.log('[Reset GUID] Backup criado:', originalGuid);
        }
      } catch (err) {
        console.error('[Reset GUID] Erro ao criar backup:', err);
      }
    }
    
    const newGUID = crypto.randomUUID().toLowerCase();

    // Criar arquivo .reg temporário
    const regContent = `Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography]
"MachineGuid"="${newGUID}"
`;
    
    const tempRegPath = path.join(app.getPath('temp'), 'reset-guid.reg');
    await fs.writeFile(tempRegPath, regContent, 'utf8');
    
    // Executar com elevação
    await execAsync(`powershell -Command "Start-Process regedit -ArgumentList '/s','${tempRegPath}' -Verb RunAs"`);
    
    // Limpar arquivo temporário
    setTimeout(async () => {
      try {
        await fs.unlink(tempRegPath);
      } catch (err) {
        console.error('Erro ao deletar arquivo temporário:', err);
      }
    }, 2000);
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Handler para resetar IDs secundários (HwProfileGuid, SusClientId, SusClientIDValidation)
ipcMain.handle('reset-secondary-ids', async () => {
  try {
    const crypto = require('crypto');
    
    // Criar pasta de utilidades para backups
    const utilitiesDir = path.join(savesDir, 'utilidades');
    await fs.mkdir(utilitiesDir, { recursive: true });
    
    const backupPath = path.join(utilitiesDir, 'backup_secondary_ids.txt');
    
    // Verificar se o backup já existe
    let needsBackup = false;
    try {
      await fs.access(backupPath);
      console.log('[Reset Secondary IDs] Backup já existe, pulando criação');
    } catch (err) {
      needsBackup = true;
    }
    
    // Criar backup dos valores originais se for a primeira vez
    if (needsBackup) {
      try {
        let backupContent = `# Backup de IDs Secundários - ${new Date().toISOString()}\n\n`;
        
        // Backup HwProfileGuid
        try {
          const { stdout: hwStdout } = await execAsync('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\IDConfigDB\\Hardware Profiles\\0001" /v HwProfileGuid');
          const hwMatch = hwStdout.match(/HwProfileGuid\s+REG_SZ\s+(.+)/);
          if (hwMatch) {
            backupContent += `HwProfileGuid=${hwMatch[1].trim()}\n`;
          }
        } catch (err) {
          backupContent += `HwProfileGuid=NOT_FOUND\n`;
        }
        
        // Backup SusClientId
        try {
          const { stdout: susStdout } = await execAsync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate" /v SusClientId');
          const susMatch = susStdout.match(/SusClientId\s+REG_SZ\s+(.+)/);
          if (susMatch) {
            backupContent += `SusClientId=${susMatch[1].trim()}\n`;
          }
        } catch (err) {
          backupContent += `SusClientId=NOT_FOUND\n`;
        }
        
        // Backup SusClientIDValidation
        try {
          const { stdout: valStdout } = await execAsync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate" /v SusClientIDValidation');
          const valMatch = valStdout.match(/SusClientIDValidation\s+REG_BINARY\s+(.+)/);
          if (valMatch) {
            backupContent += `SusClientIDValidation=${valMatch[1].trim()}\n`;
          }
        } catch (err) {
          backupContent += `SusClientIDValidation=NOT_FOUND\n`;
        }
        
        await fs.writeFile(backupPath, backupContent, 'utf8');
        console.log('[Reset Secondary IDs] Backup criado');
      } catch (err) {
        console.error('[Reset Secondary IDs] Erro ao criar backup:', err);
      }
    }
    
    // Gerar novos IDs
    const newHwProfileGuid = '{' + crypto.randomUUID().toUpperCase() + '}';
    const newSusClientId = crypto.randomUUID();
    
    // Criar arquivo .reg temporário
    const regContent = `Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\IDConfigDB\\Hardware Profiles\\0001]
"HwProfileGuid"="${newHwProfileGuid}"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate]
"SusClientId"="${newSusClientId}"
"SusClientIDValidation"=-
`;
    
    const tempRegPath = path.join(app.getPath('temp'), 'reset-secondary-ids.reg');
    await fs.writeFile(tempRegPath, regContent, 'utf8');
    
    // Executar com elevação
    await execAsync(`powershell -Command "Start-Process regedit -ArgumentList '/s','${tempRegPath}' -Verb RunAs"`);
    
    // Limpar arquivo temporário
    setTimeout(async () => {
      try {
        await fs.unlink(tempRegPath);
      } catch (err) {
        console.error('Erro ao deletar arquivo temporário:', err);
      }
    }, 2000);
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Handler para checar se cache do War Thunder existe
ipcMain.handle('check-warthunder-cache', async () => {
  try {
    let needsCleaning = false;
    
    console.log('[Check WarThunder] Iniciando checagem...');
    
    // CHECK 1: Cache do GameConfigStore (o que realmente é limpo)
    try {
      const searchCommand = `powershell -Command "Get-ChildItem 'HKCU:\\System\\GameConfigStore\\Children' -ErrorAction SilentlyContinue | ForEach-Object { $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; if ($props.MatchedExeFullPath -like '*WarThunder\\win64\\aces.exe' -and $props.ExeParentDirectory -eq 'Thunder') { $_.PSPath -replace 'Microsoft.PowerShell.Core\\\\Registry::', '' } }"`;
      const { stdout } = await execAsync(searchCommand);
      const registryPath = stdout.trim();
      
      // Verificar se retornou um caminho válido
      if (registryPath && registryPath.length > 10 && registryPath.includes('HKEY_CURRENT_USER')) {
        needsCleaning = true;
        console.log('[Check WarThunder] GameConfigStore encontrado:', registryPath);
      } else {
        console.log('[Check WarThunder] GameConfigStore NÃO encontrado');
      }
    } catch (err) {
      console.log('[Check WarThunder] GameConfigStore NÃO encontrado (erro)');
    }
    
    // CHECK 2: Registro do Uninstall (só verifica se ainda não encontrou)
    if (!needsCleaning) {
      try {
        const uninstallPath = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{ed8deea4-29fa-3932-9612-e2122d8a62d9}}_is1';
        const { stdout } = await execAsync(`reg query "${uninstallPath}" 2>nul`);
        
        // Verificar se realmente existe - reg query retorna várias linhas quando encontra
        const lines = stdout.trim().split('\n').filter(l => l.trim().length > 0);
        if (lines.length > 1) {
          needsCleaning = true;
          console.log('[Check WarThunder] Uninstall registry encontrado');
        } else {
          console.log('[Check WarThunder] Uninstall registry NÃO encontrado');
        }
      } catch (err) {
        console.log('[Check WarThunder] Uninstall registry NÃO encontrado (erro)');
      }
    }
    
    console.log('[Check WarThunder] RESULTADO FINAL: needsCleaning =', needsCleaning);
    return { success: true, needsCleaning };
  } catch (err) {
    console.error('[Check WarThunder] Erro fatal:', err);
    return { success: false, error: err.message };
  }
});

// Handler para limpar cache do War Thunder
ipcMain.handle('clear-warthunder-cache', async () => {
  try {
    let deletedCache = false;
    let deletedUninstall = false;
    let cacheError = null;
    let uninstallError = null;

    // Tentar apagar o cache do GameConfigStore
    try {
      const searchCommand = `powershell -Command "Get-ChildItem 'HKCU:\\System\\GameConfigStore\\Children' | ForEach-Object { $props = Get-ItemProperty $_.PSPath; if ($props.MatchedExeFullPath -like '*WarThunder\\win64\\aces.exe' -and $props.ExeParentDirectory -eq 'Thunder') { $_.PSPath -replace 'Microsoft.PowerShell.Core\\\\Registry::', '' } }"`;
      
      const { stdout } = await execAsync(searchCommand);
      const registryPath = stdout.trim();
      
      if (registryPath) {
        // Deletar a chave encontrada
        await execAsync(`reg delete "${registryPath}" /f`);
        deletedCache = true;
      } else {
        cacheError = 'não encontrado';
      }
    } catch (err) {
      cacheError = err.message;
    }

    // Tentar apagar o registro do Uninstall
    try {
      const uninstallPath = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{ed8deea4-29fa-3932-9612-e2122d8a62d9}}_is1';
      
      // Verificar se a chave existe
      try {
        await execAsync(`reg query "${uninstallPath}"`);
        // Se chegou aqui, a chave existe, então deletar
        await execAsync(`reg delete "${uninstallPath}" /f`);
        deletedUninstall = true;
      } catch (err) {
        // Chave não existe
        uninstallError = 'não encontrado';
      }
    } catch (err) {
      uninstallError = err.message;
    }

    // Decidir a mensagem de retorno
    if (deletedCache && deletedUninstall) {
      return { 
        success: true, 
        message: 'Limpeza de cache bem sucedida!\n\nOs dois registros do War Thunder foram apagados.' 
      };
    } else if (deletedCache && !deletedUninstall) {
      return { 
        success: true, 
        message: 'Limpeza de cache parcialmente bem sucedida!\n\nCache do jogo apagado.\nRegistro de uninstall já estava apagado ou não foi encontrado.' 
      };
    } else if (!deletedCache && deletedUninstall) {
      return { 
        success: true, 
        message: 'Limpeza de cache parcialmente bem sucedida!\n\nRegistro de uninstall apagado.\nCache do jogo já estava apagado ou não foi encontrado.' 
      };
    } else {
      const errorMsg = `Nenhum registro foi encontrado.\n\nCache do jogo: ${cacheError}\nRegistro de uninstall: ${uninstallError}`;
      return { 
        success: false, 
        error: errorMsg
      };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Handler para ler Machine GUID atual
ipcMain.handle('get-machine-guid', async () => {
  try {
    const { stdout } = await execAsync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid');
    const match = stdout.match(/MachineGuid\s+REG_SZ\s+(.+)/);
    if (match && match[1]) {
      return { success: true, guid: match[1].trim() };
    }
    return { success: false, error: 'GUID não encontrado' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Handler para checar se cache MiHoYo existe
ipcMain.handle('check-mihoyo-cache', async () => {
  try {
    let needsCleaning = false;
    let foundItems = [];
    
    console.log('[Check MiHoYo] Iniciando checagem...');
    
    // Checar registros (mesmas chaves do morra_mihoyo.reg)
    const registryKeys = [
      'HKEY_CURRENT_USER\\SOFTWARE\\miHoYo',
      'HKEY_CURRENT_USER\\SOFTWARE\\miHoYoSDK',
      'HKEY_CURRENT_USER\\SOFTWARE\\Cognosphere'
    ];
    
    for (const key of registryKeys) {
      try {
        const { stdout, stderr } = await execAsync(`reg query "${key}" 2>&1`);
        
        if (!stdout.includes('ERROR:') && !stderr) {
          const lines = stdout.trim().split('\n').filter(l => {
            const trimmed = l.trim();
            return trimmed.length > 0 && 
                   !trimmed.startsWith('HKEY_') && 
                   trimmed !== key;
          });
          
          if (lines.length > 0) {
            needsCleaning = true;
            foundItems.push(`Registro: ${key}`);
            console.log(`[Check MiHoYo] Registro ${key}: ENCONTRADO`);
          } else {
            console.log(`[Check MiHoYo] Registro ${key}: vazio`);
          }
        } else {
          console.log(`[Check MiHoYo] Registro ${key}: não existe`);
        }
      } catch (e) {
        console.log(`[Check MiHoYo] Registro ${key}: não existe (catch)`);
      }
    }
    
    // Checar pastas AppData
    const appDataPaths = [
      { name: 'LocalLow\\miHoYo', path: path.join(process.env.APPDATA, '..', 'LocalLow', 'miHoYo') },
      { name: 'LOCALAPPDATA\\miHoYo', path: path.join(process.env.LOCALAPPDATA, 'miHoYo') }
    ];
    
    for (const folder of appDataPaths) {
      try {
        const stats = await fs.stat(folder.path);
        if (stats.isDirectory()) {
          const contents = await fs.readdir(folder.path);
          if (contents.length > 0) {
            needsCleaning = true;
            foundItems.push(`Pasta: ${folder.name} (${contents.length} itens)`);
            console.log(`[Check MiHoYo] Pasta ${folder.name}: ENCONTRADA com ${contents.length} itens`);
          } else {
            console.log(`[Check MiHoYo] Pasta ${folder.name}: existe mas está vazia`);
          }
        }
      } catch (e) {
        console.log(`[Check MiHoYo] Pasta ${folder.name}: não existe`);
      }
    }
    
    console.log('[Check MiHoYo] RESULTADO FINAL: needsCleaning =', needsCleaning);
    if (foundItems.length > 0) {
      console.log('[Check MiHoYo] Itens encontrados:', foundItems.join(', '));
    }
    
    return { success: true, needsCleaning };
  } catch (err) {
    console.error('[Check MiHoYo] Erro:', err);
    return { success: false, error: err.message };
  }
});

// Handler para limpar cache da MiHoYo
ipcMain.handle('clear-mihoyo-cache', async () => {
  try {
    console.log('[Clear MiHoYo] Iniciando limpeza...');
    
    // Deletar pastas AppData primeiro
    const appDataPaths = [
      path.join(process.env.APPDATA, '..', 'LocalLow', 'miHoYo'),
      path.join(process.env.LOCALAPPDATA, 'miHoYo')
    ];
    
    for (const dirPath of appDataPaths) {
      try {
        await fs.rm(dirPath, { recursive: true, force: true });
        console.log(`[Clear MiHoYo] ✓ Pasta deletada: ${dirPath}`);
      } catch (err) {
        console.log(`[Clear MiHoYo] Pasta não existe ou erro: ${dirPath}`);
      }
    }
    
    // Deletar chaves de registro (as mesmas do .reg)
    const registryKeys = [
      'HKEY_CURRENT_USER\\SOFTWARE\\miHoYo',
      'HKEY_CURRENT_USER\\SOFTWARE\\miHoYoSDK',
      'HKEY_CURRENT_USER\\SOFTWARE\\Cognosphere'
    ];
    
    console.log('[Clear MiHoYo] Deletando registros...');
    
    for (const key of registryKeys) {
      try {
        await execAsync(`reg delete "${key}" /f 2>nul`);
        console.log(`[Clear MiHoYo] ✓ Registro deletado: ${key}`);
      } catch (err) {
        console.log(`[Clear MiHoYo] Registro não existe: ${key}`);
      }
    }
    
    console.log('[Clear MiHoYo] Limpeza concluída!');
    return { success: true };
  } catch (err) {
    console.error('[Clear MiHoYo] Erro:', err);
    return { success: false, error: err.message };
  }
});

// Handlers para controles da janela
ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// Handler para resetar MAC Address - MÉTODO AVANÇADO
ipcMain.handle('reset-mac-address', async (event, adapterName) => {
  try {
    // Criar pasta de utilidades para backups
    const utilitiesDir = path.join(savesDir, 'utilidades');
    await fs.mkdir(utilitiesDir, { recursive: true });
    
    const backupPath = path.join(utilitiesDir, 'backup_mac_address.txt');
    
    // Verificar se o backup já existe
    let needsBackup = false;
    try {
      await fs.access(backupPath);
      console.log('[Reset MAC] Backup já existe, pulando criação');
    } catch (err) {
      needsBackup = true;
    }
    
    // Criar backup do MAC original se for a primeira vez
    if (needsBackup) {
      try {
        const { stdout } = await execAsync(`powershell -Command "Get-NetAdapter -Name '${adapterName}' | Select-Object -ExpandProperty MacAddress"`);
        const originalMac = stdout.trim();
        
        const backupContent = `# Backup de MAC Address - ${new Date().toISOString()}\n\nAdapter=${adapterName}\nOriginalMAC=${originalMac}\n`;
        await fs.writeFile(backupPath, backupContent, 'utf8');
        console.log('[Reset MAC] Backup criado:', originalMac);
      } catch (err) {
        console.error('[Reset MAC] Erro ao criar backup:', err);
      }
    }
    
    // Gerar MAC aleatório
    const prefixos = ['00', '02', '06', '0A', '0E', '12', '16', '1A', '1E', '22', '26', '2A', '2E', '32', '36', '3A', '3E'];
    const prefix = prefixos[Math.floor(Math.random() * prefixos.length)];
    const hex = '0123456789ABCDEF';
    let novoMac = prefix;
    
    for (let i = 0; i < 10; i++) {
      novoMac += hex[Math.floor(Math.random() * 16)];
    }
    
    const macFormatado = `${novoMac.slice(0,2)}-${novoMac.slice(2,4)}-${novoMac.slice(4,6)}-${novoMac.slice(6,8)}-${novoMac.slice(8,10)}-${novoMac.slice(10,12)}`;
    
    // Script PowerShell AVANÇADO - múltiplas técnicas
    const psScript = `
# Variáveis
\$adapterName = "${adapterName}"
\$newMAC = "${novoMac}"
\$success = \$false

# Função para encontrar Device ID
function Get-AdapterDeviceID {
    param([string]\$Name)
    try {
        \$adapter = Get-WmiObject -Class Win32_NetworkAdapter | Where-Object { \$_.NetConnectionID -eq \$Name }
        return \$adapter.PNPDeviceID
    } catch {
        return \$null
    }
}

# Função para reiniciar dispositivo via PnP
function Restart-Device {
    param([string]\$DeviceID)
    if (\$DeviceID) {
        try {
            # Desabilitar via PnP
            (Get-WmiObject -Class Win32_PnPEntity | Where-Object { \$_.DeviceID -eq \$DeviceID }).Disable()
            Start-Sleep -Seconds 2
            # Habilitar via PnP
            (Get-WmiObject -Class Win32_PnPEntity | Where-Object { \$_.DeviceID -eq \$DeviceID }).Enable()
            return \$true
        } catch {
            return \$false
        }
    }
    return \$false
}

# Passo 1: Desabilitar adaptador (método NetAdapter)
try {
    Disable-NetAdapter -Name \$adapterName -Confirm:\$false -ErrorAction Stop
    Start-Sleep -Seconds 2
} catch {}

# Passo 2: Encontrar TODAS as chaves do registro relacionadas
\$regPaths = @()

# Método 1: Via reg query
\$regQuery = reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4D36E972-E325-11CE-BFC1-08002BE10318}" /s /f "\$adapterName" 2>&1
foreach (\$line in \$regQuery) {
    if (\$line -match "HKEY_LOCAL_MACHINE") {
        \$regPaths += \$line.Trim()
    }
}

# Método 2: Via PowerShell (backup)
try {
    Get-ChildItem "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4D36E972-E325-11CE-BFC1-08002BE10318}" | ForEach-Object {
        \$props = Get-ItemProperty \$_.PSPath -ErrorAction SilentlyContinue
        if (\$props.DriverDesc -eq \$adapterName -or \$props.NetCfgInstanceId) {
            \$regPaths += \$_.PSPath -replace "Microsoft.PowerShell.Core\\\\Registry::", ""
        }
    }
} catch {}

# Remover duplicatas
\$regPaths = \$regPaths | Select-Object -Unique

# Passo 3: Aplicar MAC em TODAS as chaves encontradas
foreach (\$regPath in \$regPaths) {
    try {
        # Método 1: via reg add
        reg add "\$regPath" /v NetworkAddress /t REG_SZ /d "\$newMAC" /f 2>&1 | Out-Null
        
        # Método 2: via PowerShell (dupla garantia)
        if (\$regPath -match "HKEY_LOCAL_MACHINE") {
            \$psPath = \$regPath -replace "HKEY_LOCAL_MACHINE", "HKLM:"
            Set-ItemProperty -Path \$psPath -Name "NetworkAddress" -Value \$newMAC -Force -ErrorAction SilentlyContinue
        }
        
        \$success = \$true
    } catch {}
}

# Passo 4: Reiniciar dispositivo via WMI (mais profundo que Disable/Enable)
\$deviceID = Get-AdapterDeviceID -Name \$adapterName
if (\$deviceID) {
    Restart-Device -DeviceID \$deviceID | Out-Null
    Start-Sleep -Seconds 3
}

# Passo 5: Habilitar adaptador (método NetAdapter)
try {
    Enable-NetAdapter -Name \$adapterName -Confirm:\$false -ErrorAction Stop
    Start-Sleep -Seconds 4
} catch {}

# Passo 6: Verificar resultado
try {
    \$currentMAC = Get-NetAdapter -Name \$adapterName -ErrorAction Stop | Select-Object -ExpandProperty MacAddress
    
    # Salvar resultado
    if (\$success) {
        \$currentMAC | Out-File -FilePath "$env:TEMP\\mac-result.txt" -Encoding UTF8
    } else {
        "ERRO: Nenhuma chave de registro encontrada" | Out-File -FilePath "$env:TEMP\\mac-result.txt" -Encoding UTF8
    }
} catch {
    if (\$success) {
        "${macFormatado}" | Out-File -FilePath "$env:TEMP\\mac-result.txt" -Encoding UTF8
    } else {
        "ERRO: Falha ao verificar MAC" | Out-File -FilePath "$env:TEMP\\mac-result.txt" -Encoding UTF8
    }
}
`;
    
    const tempPsPath = path.join(app.getPath('temp'), 'reset-mac-advanced.ps1');
    await fs.writeFile(tempPsPath, psScript, 'utf8');
    
    // Executar com elevação e AGUARDAR
    await execAsync(`powershell -Command "Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -NoProfile -File \\"${tempPsPath}\\"' -Verb RunAs -Wait"`);
    
    // Aguardar processamento completo
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Ler resultado
    const resultPath = path.join(app.getPath('temp'), 'mac-result.txt');
    let resultMac = macFormatado;
    let hasError = false;
    
    try {
      const content = await fs.readFile(resultPath, 'utf8');
      const trimmed = content.trim();
      
      if (trimmed.startsWith('ERRO:')) {
        hasError = true;
        resultMac = trimmed;
      } else {
        resultMac = trimmed;
      }
      
      await fs.unlink(resultPath);
    } catch (err) {
      hasError = true;
      resultMac = 'ERRO: Não foi possível verificar o resultado';
    }
    
    // Limpar script
    setTimeout(async () => {
      try {
        await fs.unlink(tempPsPath);
      } catch (err) {}
    }, 2000);
    
    if (hasError) {
      return { success: false, error: resultMac };
    }
    
    return { success: true, newMac: resultMac };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Handler para listar adaptadores de rede
ipcMain.handle('list-network-adapters', async () => {
  try {
    const { stdout } = await execAsync('powershell -Command "Get-NetAdapter | Where-Object {$_.Status -eq \'Up\'} | Select-Object Name,InterfaceDescription,MacAddress | ConvertTo-Json"');
    const adapters = JSON.parse(stdout);
    const adapterArray = Array.isArray(adapters) ? adapters : [adapters];
    return { success: true, adapters: adapterArray };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Handler para checar se cache do Endfield existe
ipcMain.handle('check-endfield-cache', async () => {
  try {
    let needsCleaning = false;
    let foundItems = [];
    
    console.log('[Check Endfield] Iniciando checagem...');
    
    // CHECK REGISTROS
    // CHECK REGISTROS COM BUSCA FLEXÍVEL POR PREFIXOS
    const registryPrefixes = [
      { base: 'HKEY_CURRENT_USER\\SOFTWARE\\Gryphline', prefixes: ['u8sdk_cached_uid_', 'unity.player_session_count_', 'unity.player_sessionid_'] },
      { base: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Gryphline', prefixes: ['u8sdk_cached_uid_', 'unity.player_session_count_', 'unity.player_sessionid_'] },
      { base: 'HKEY_CURRENT_USER\\Software\\Gryphline', prefixes: ['u8sdk_cached_uid_', 'unity.player_session_count_', 'unity.player_sessionid_'] }
    ];
    
    for (const { base, prefixes } of registryPrefixes) {
      for (const prefix of prefixes) {
        try {
          // Buscar valores que começam com o prefixo específico
          const { stdout } = await execAsync(`reg query "${base}" /v /f "${prefix}" 2>nul`);
          if (stdout && stdout.trim().length > 0 && !stdout.includes('ERROR:')) {
            needsCleaning = true;
            foundItems.push(`Registro: ${base}\\${prefix}*`);
            console.log(`[Check Endfield] Registro encontrado: ${base}\\${prefix}*`);
          }
        } catch (e) {
          console.log(`[Check Endfield] Registro ${base}\\${prefix}*: não existe`);
        }
      }
    }
    
    // Também verificar registros GRYPHLINK gerais (mantendo a verificação original)
    const registriesToCheck = [
      'HKEY_CURRENT_USER\\SOFTWARE\\GRYPHLINK',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\GRYPHLINK',
      'HKEY_CURRENT_USER\\Software\\GRYPHLINK'
    ];
    
    for (const regPath of registriesToCheck) {
      try {
        const { stdout, stderr } = await execAsync(`reg query "${regPath}" 2>&1`);
        
        // Verificar se NÃO teve erro (não contém "ERROR:")
        if (!stdout.includes('ERROR:') && !stderr) {
          // Verificar se tem conteúdo real (mais que apenas o cabeçalho)
          const lines = stdout.trim().split('\n').filter(l => {
            const trimmed = l.trim();
            return trimmed.length > 0 && 
                   !trimmed.startsWith('HKEY_') && // Ignora linha do próprio caminho
                   trimmed !== regPath; // Ignora repetição do path
          });
          
          if (lines.length > 0) {
            needsCleaning = true;
            foundItems.push(`Registro: ${regPath}`);
            console.log(`[Check Endfield] Registro ${regPath}: ENCONTRADO (${lines.length} entradas)`);
          } else {
            console.log(`[Check Endfield] Registro ${regPath}: vazio`);
          }
        } else {
          console.log(`[Check Endfield] Registro ${regPath}: não existe`);
        }
      } catch (e) {
        // Erro significa que não existe
        console.log(`[Check Endfield] Registro ${regPath}: não existe (catch)`);
      }
    }
    
    // CHECK PASTAS (SEMPRE verifica todas, não para no primeiro)
    const foldersToCheck = [
      { name: 'LOCALAPPDATA\\Gryphline', path: path.join(process.env.LOCALAPPDATA, 'Gryphline') },
      { name: 'LocalLow\\Gryphline', path: path.join(process.env.APPDATA, '..', 'LocalLow', 'Gryphline') },
      { name: 'Local\\Gryphline', path: path.join(process.env.APPDATA, '..', 'Local', 'Gryphline') },
      { name: 'HGEventLog', path: path.join(process.env.PUBLIC, 'Documents', 'HGEventLog') },
      { name: 'HGEventLog_Encrypted', path: path.join(process.env.PUBLIC, 'Documents', 'HGEventLog_Encrypted') }
    ];
    
    for (const folder of foldersToCheck) {
      try {
        const stats = await fs.stat(folder.path);
        if (stats.isDirectory()) {
          const contents = await fs.readdir(folder.path);
          if (contents.length > 0) {
            needsCleaning = true;
            foundItems.push(`Pasta: ${folder.name} (${contents.length} itens)`);
            console.log(`[Check Endfield] Pasta ${folder.name}: ENCONTRADA com ${contents.length} itens`);
          } else {
            console.log(`[Check Endfield] Pasta ${folder.name}: existe mas está vazia`);
          }
        }
      } catch (e) {
        console.log(`[Check Endfield] Pasta ${folder.name}: não existe`);
      }
    }
    
    console.log('[Check Endfield] RESULTADO FINAL: needsCleaning =', needsCleaning);
    if (foundItems.length > 0) {
      console.log('[Check Endfield] Itens encontrados:', foundItems.join(', '));
    }
    
    return { success: true, needsCleaning };
  } catch (err) {
    console.error('[Check Endfield] Erro fatal:', err);
    return { success: false, error: err.message };
  }
});

// Handler para limpar cache do Endfield
ipcMain.handle('clear-endfield-cache', async () => {
  try {
    console.log('[Clear Endfield] Iniciando limpeza...');
    let deletionErrors = [];
    
    // Parar processos
    console.log('[Clear Endfield] Parando processos...');
    const processCommands = [
      'taskkill /F /IM Downloader.exe 2>nul',
      'taskkill /F /IM ArknightsEndfield*.exe 2>nul'
    ];
    
    for (const cmd of processCommands) {
      try {
        await execAsync(cmd);
      } catch (err) {
        // Processo não estava rodando, ok
      }
    }
    
    // Deletar registros GRYPHLINK e registros com prefixos específicos
    console.log('[Clear Endfield] Deletando registros...');
    const registryCommands = [
      'reg delete "HKEY_CURRENT_USER\\SOFTWARE\\GRYPHLINK" /f 2>nul',
      'reg delete "HKEY_LOCAL_MACHINE\\SOFTWARE\\GRYPHLINK" /f 2>nul',
      'reg delete "HKEY_CURRENT_USER\\Software\\GRYPHLINK" /f 2>nul'
    ];
    
    // Adicionar comandos para deletar valores com prefixos específicos
    const registryPrefixes = [
      'u8sdk_cached_uid_',
      'unity.player_session_count_',
      'unity.player_sessionid_'
    ];
    
    const registryBases = [
      'HKEY_CURRENT_USER\\SOFTWARE\\Gryphline',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Gryphline',
      'HKEY_CURRENT_USER\\Software\\Gryphline'
    ];
    
    // Para cada base de registro, tentar deletar valores com cada prefixo
    for (const base of registryBases) {
      for (const prefix of registryPrefixes) {
        try {
          // Primeiro, listar os valores que correspondem ao prefixo
          const { stdout } = await execAsync(`reg query "${base}" /v /f "${prefix}" 2>nul`);
          if (stdout && stdout.trim().length > 0) {
            // Extrair nomes dos valores encontrados
            const lines = stdout.split('\n');
            for (const line of lines) {
              const match = line.match(/\s+(u8sdk_cached_uid_\S+|unity\.player_session_count_\S+|unity\.player_sessionid_\S+)\s+/);
              if (match) {
                const valueName = match[1];
                try {
                  await execAsync(`reg delete "${base}" /v "${valueName}" /f 2>nul`);
                  console.log(`[Clear Endfield] Deletado registro: ${base}\\${valueName}`);
                } catch (err) {
                  // Valor não pôde ser deletado
                }
              }
            }
          }
        } catch (err) {
          // Prefixo não encontrado ou erro, continuar
        }
      }
    }
    
    for (const cmd of registryCommands) {
      try {
        await execAsync(cmd);
      } catch (err) {
        // Registro não existe, ok
      }
    }
    
    // Deletar pastas AppData com método robusto
    console.log('[Clear Endfield] Deletando pastas...');
    const appDataPaths = [
      { name: 'Local\\Gryphline', path: path.join(process.env.APPDATA, '..', 'Local', 'Gryphline') },
      { name: 'LocalLow\\Gryphline', path: path.join(process.env.APPDATA, '..', 'LocalLow', 'Gryphline') },
      { name: 'LOCALAPPDATA\\Gryphline', path: path.join(process.env.LOCALAPPDATA, 'Gryphline') },
      { name: 'HGEventLog', path: path.join(process.env.PUBLIC, 'Documents', 'HGEventLog') },
      { name: 'HGEventLog_Encrypted', path: path.join(process.env.PUBLIC, 'Documents', 'HGEventLog_Encrypted') }
    ];
    
    // Criar script batch simples e eficaz
    const batchScript = `@echo off
echo [Batch Admin] Iniciando limpeza do Endfield...

${appDataPaths.map((folder, idx) => `
if exist "${folder.path}" (
    echo [Batch Admin] Deletando: ${folder.name}
    
    REM Remover atributos
    attrib -r -s -h "${folder.path}\\*.*" /s /d >nul 2>&1
    
    REM Tomar posse
    takeown /F "${folder.path}" /R /D Y >nul 2>&1
    icacls "${folder.path}" /grant *S-1-1-0:F /T /C /Q >nul 2>&1
    
    REM Deletar pasta
    rd /s /q "${folder.path}" >nul 2>&1
    
    if exist "${folder.path}" (
        echo [Batch Admin] FALHA: ${folder.name}
        echo ${folder.name}>> "%TEMP%\\endfield-failed.txt"
    ) else (
        echo [Batch Admin] OK: ${folder.name}
        echo ${folder.name}>> "%TEMP%\\endfield-deleted.txt"
    )
)
`).join('\n')}

echo [Batch Admin] Concluido
exit
`;

    // Salvar script batch
    const batchPath = path.join(app.getPath('temp'), 'delete-endfield-cache.bat');
    await fs.writeFile(batchPath, batchScript, 'utf8');
    
    // Limpar arquivos de resultado anteriores
    const deletedFile = path.join(app.getPath('temp'), 'endfield-deleted.txt');
    const failedFile = path.join(app.getPath('temp'), 'endfield-failed.txt');
    await fs.unlink(deletedFile).catch(() => {});
    await fs.unlink(failedFile).catch(() => {});
    
    console.log('[Clear Endfield] Script batch criado');
    console.log('[Clear Endfield] Solicitando permissões de administrador...');
    
    try {
      // Executar batch como administrador
      await execAsync(
        `powershell -Command "Start-Process cmd -ArgumentList '/c \\"${batchPath}\\"' -Verb RunAs -Wait"`,
        { timeout: 45000 }
      );
      
      console.log('[Clear Endfield] Script executado');
      
      // Aguardar processamento
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Ler resultados
      let deletedFolders = [];
      let failedFolders = [];
      
      try {
        const deletedData = await fs.readFile(deletedFile, 'utf8');
        deletedFolders = deletedData.trim().split('\n').filter(f => f.length > 0);
      } catch (err) {
        // Arquivo não existe = nenhuma pasta deletada
      }
      
      try {
        const failedData = await fs.readFile(failedFile, 'utf8');
        failedFolders = failedData.trim().split('\n').filter(f => f.length > 0);
      } catch (err) {
        // Arquivo não existe = nenhuma falha
      }
      
      console.log('[Clear Endfield] Pastas deletadas:', deletedFolders);
      if (failedFolders.length > 0) {
        console.log('[Clear Endfield] Pastas com falha:', failedFolders);
        deletionErrors = failedFolders;
      }
      
      // Limpar arquivos temporários
      await fs.unlink(deletedFile).catch(() => {});
      await fs.unlink(failedFile).catch(() => {});
      await fs.unlink(batchPath).catch(() => {});
      
    } catch (execErr) {
      console.error('[Clear Endfield] Erro ao executar batch elevado:', execErr.message);
      
      // Fallback: tentar sem admin com timeout curto
      console.log('[Clear Endfield] Tentando sem admin...');
      
      for (const folder of appDataPaths) {
        try {
          await fs.access(folder.path);
          
          await Promise.race([
            fs.rm(folder.path, { recursive: true, force: true }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
          ]);
          
          console.log(`[Clear Endfield] ✓ ${folder.name}`);
        } catch (err) {
          console.log(`[Clear Endfield] ✗ ${folder.name}`);
          deletionErrors.push(folder.name);
        }
      }
    }
    
    // Deletar arquivos temporários
    console.log('[Clear Endfield] Limpando arquivos temporários...');
    const tempDir = process.env.TEMP;
    const tempPatterns = [
      'ns*.tmp',
      '*Downloader*.exe',
      '*Arknights*.exe'
    ];
    
    for (const pattern of tempPatterns) {
      try {
        await execAsync(`del /f /q "${path.join(tempDir, pattern)}" 2>nul`);
      } catch (err) {
        // Arquivos não existem, ok
      }
    }
    
    // Limpar bancos de dados SQLite relacionados
    console.log('[Clear Endfield] Limpando bancos de dados...');
    const dbPaths = [
      process.env.APPDATA,
      process.env.LOCALAPPDATA
    ];
    
    for (const dbPath of dbPaths) {
      try {
        await execAsync(`powershell -Command "Get-ChildItem -Path '${dbPath}' -Filter *.db -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'eld_Downloader|crashsight' } | Remove-Item -Force -ErrorAction SilentlyContinue"`);
      } catch (err) {
        // Ignora erros
      }
    }
    
    // Limpar arquivos Desktop/Downloads
    console.log('[Clear Endfield] Limpando Desktop/Downloads...');
    const userProfile = process.env.USERPROFILE;
    const exePatterns = [
      path.join(userProfile, 'Desktop', 'Arknights*.exe'),
      path.join(userProfile, 'Downloads', 'Arknights*.exe')
    ];
    
    for (const pattern of exePatterns) {
      try {
        await execAsync(`del /f /q "${pattern}" 2>nul`);
      } catch (err) {
        // Arquivos não existem, ok
      }
    }
    
    // Limpar DNS
    console.log('[Clear Endfield] Limpando cache DNS...');
    try {
      await execAsync('ipconfig /flushdns');
    } catch (err) {
      // Ignora erro
    }
    
    console.log('[Clear Endfield] Limpeza concluída!');
    
    if (deletionErrors.length > 0) {
      console.warn('[Clear Endfield] Algumas pastas não puderam ser deletadas:', deletionErrors);
      return { 
        success: true, 
        warning: `Algumas pastas não puderam ser deletadas: ${deletionErrors.join(', ')}. Tente fechar todos os programas relacionados e execute novamente.` 
      };
    }
    
    return { success: true };
  } catch (err) {
    console.error('[Clear Endfield] Erro fatal:', err);
    return { success: false, error: err.message };
  }
});

// Handler para limpeza Kameleo completa - VERSÃO DE TESTES
ipcMain.handle('clear-kameleo-cache', async () => {
  try {
    console.log('[Clear Kameleo TESTE] Iniciando limpeza avançada...');
    
    // Criar pasta de utilidades para backups
    const utilitiesDir = path.join(savesDir, 'utilidades');
    await fs.mkdir(utilitiesDir, { recursive: true });
    
    // ETAPA 1: Fechar processos Kameleo
    console.log('[Clear Kameleo TESTE] Encerrando processos...');
    const processes = ['Kameleo.exe', 'Kameleo.CLI.exe'];
    for (const proc of processes) {
      try {
        await execAsync(`taskkill /F /IM ${proc} 2>nul`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        // Processo não estava rodando
      }
    }
    
    // ETAPA 2: Deletar arquivos AppData
    console.log('[Clear Kameleo TESTE] Deletando arquivos...');
    const appDataPath = path.join(process.env.APPDATA, 'Kameleo');
    try {
      await fs.rm(appDataPath, { recursive: true, force: true });
      console.log('[Clear Kameleo TESTE] ✓ AppData deletado');
    } catch (err) {
      console.log('[Clear Kameleo TESTE] AppData não existe ou erro');
    }
    
    // ====================================================================
    // VERSÃO DE TESTES: NÃO DELETA c.db e appsettings.json
    // ====================================================================
    console.log('[Clear Kameleo TESTE] PULANDO deleção de c.db e appsettings.json (versão de testes)');
    
    // ETAPA 3: Modificar valores do Registry (IDs secundários)
    console.log('[Clear Kameleo TESTE] Modificando valores do Registry...');
    const crypto = require('crypto');
    
    const newHwProfileGuid = '{' + crypto.randomUUID().toUpperCase() + '}';
    const newSusClientId = crypto.randomUUID();
    
    // Criar arquivo .reg temporário para IDs secundários
    const regContent = `Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\IDConfigDB\\Hardware Profiles\\0001]
"HwProfileGuid"="${newHwProfileGuid}"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate]
"SusClientId"="${newSusClientId}"
"SusClientIDValidation"=-
`;
    
    const tempRegPath = path.join(app.getPath('temp'), 'kameleo-secondary-ids.reg');
    await fs.writeFile(tempRegPath, regContent, 'utf8');
    
    await execAsync(`powershell -Command "Start-Process regedit -ArgumentList '/s','${tempRegPath}' -Verb RunAs"`);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      await fs.unlink(tempRegPath);
    } catch (err) {}
    
    // ETAPA 4: Limpar DNS e temp
    console.log('[Clear Kameleo TESTE] Limpando DNS e temp...');
    try {
      await execAsync('ipconfig /flushdns');
    } catch (err) {}
    
    try {
      await execAsync(`del /f /s /q "${process.env.TEMP}\\*" 2>nul`);
    } catch (err) {}
    
    console.log('[Clear Kameleo TESTE] Limpeza avançada concluída!');
    return { success: true, utilitiesPath: utilitiesDir };
  } catch (err) {
    console.error('[Clear Kameleo TESTE] Erro:', err);
    return { success: false, error: err.message };
  }
});

// ========== HANDLERS DO AUTO-UPDATER ==========

// Handler para verificar atualizações manualmente (usado pelo painel de debug)
ipcMain.handle('check-for-updates', async () => {
  try {
    if (!app.isPackaged) {
      console.log('[AutoUpdater] Modo desenvolvimento - atualizações desabilitadas');
      return { 
        success: false, 
        error: 'Atualizações só funcionam em produção',
        devMode: true 
      };
    }
    
    if (!autoUpdaterAvailable || !autoUpdater) {
      return { 
        success: false, 
        error: 'Auto-updater não está disponível' 
      };
    }
    
    console.log('[AutoUpdater] Verificação manual solicitada');
    const result = await autoUpdater.checkForUpdates();
    
    if (result && result.updateInfo) {
      const current = app.getVersion();
      const latest = result.updateInfo.version;
      
      console.log(`[AutoUpdater] Versão atual: ${current}`);
      console.log(`[AutoUpdater] Versão disponível: ${latest}`);
      
      // Comparar versões corretamente
      const updateAvailable = latest !== current;
      
      return { 
        success: true, 
        updateInfo: result.updateInfo,
        currentVersion: current,
        updateAvailable
      };
    }
    
    return { 
      success: true, 
      updateInfo: null,
      currentVersion: app.getVersion(),
      updateAvailable: false
    };
  } catch (err) {
    console.error('[AutoUpdater] Erro ao verificar:', err.message);
    return { success: false, error: err.message };
  }
});

// Handler para baixar atualização manualmente (usado pelo painel de debug)
ipcMain.handle('download-update', async () => {
  if (!autoUpdaterAvailable || !autoUpdater) {
    return { success: false, error: 'Auto-updater não está disponível' };
  }
  
  if (isDownloadingUpdate) {
    return { success: true, message: 'Download já em andamento' };
  }
  
  if (updateDownloaded) {
    return { success: true, message: 'Atualização já foi baixada' };
  }
  
  try {
    console.log('[AutoUpdater] Download manual solicitado');
    await autoUpdater.downloadUpdate();
    return { success: true, message: 'Download iniciado' };
  } catch (err) {
    console.error('[AutoUpdater] Erro ao baixar:', err.message);
    return { success: false, error: err.message };
  }
});

// Handler para instalar e reiniciar
ipcMain.handle('quit-and-install', () => {
  if (!autoUpdaterAvailable || !autoUpdater) {
    return { success: false, error: 'Auto-updater não está disponível' };
  }
  
  if (!updateDownloaded) {
    return { success: false, error: 'Nenhuma atualização foi baixada ainda' };
  }
  
  console.log('[AutoUpdater] Instalando e reiniciando...');
  // Instala imediatamente e reinicia o app
  autoUpdater.quitAndInstall(false, true);
  return { success: true };
});

// Handler para retornar a versão do app
ipcMain.handle('get-app-version', () => {
  try {
    const packageJson = require('./package.json');
    return { 
      success: true, 
      version: packageJson.version || app.getVersion() 
    };
  } catch (err) {
    return { 
      success: true, 
      version: app.getVersion() 
    };
  }
});