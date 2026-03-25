import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { ollamaFetch } from './ollama-proxy';

// Enable hardware acceleration
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const IS_DEV = !app.isPackaged;
const PROD_URL = 'https://drawpro.kithly.app';
const DEV_URL = 'http://localhost:3000';

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'DrawPro',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // Allow preload script to inject into the remote deployed site
      webSecurity: true,
      sandbox: false,
    },
  });

  // Always load deployed site — Electron is just a thin shell + Ollama bridge
  win.loadURL(PROD_URL);

  if (IS_DEV) {
    win.webContents.openDevTools();
  }

  return win;
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle('ollama:fetch', async (_event, url: string, body: unknown) => {
  return ollamaFetch(url, body);
});

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Quit on all platforms except macOS
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
