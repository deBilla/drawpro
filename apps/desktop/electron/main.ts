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
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load deployed site in production, local dev server in dev mode
  const url = IS_DEV ? DEV_URL : PROD_URL;
  win.loadURL(url);

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
