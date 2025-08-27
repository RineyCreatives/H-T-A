const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs-extra');
const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
let serverProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'public/icon.png')
  });

  // Start the server
  startServer();

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'public/index.html'));
  }

  mainWindow.on('closed', () => {
    // Stop the server when window is closed
    if (serverProcess) {
      serverProcess.kill();
    }
    mainWindow = null;
  });
}

function startServer() {
  // Create necessary directories
  const dirs = ['uploads', 'projects', 'output'];
  dirs.forEach(dir => {
    fs.ensureDirSync(path.join(app.getPath('userData'), dir));
  });

  // Start the server process
  serverProcess = spawn('node', [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      USER_DATA_PATH: app.getPath('userData')
    }
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`Server Error: ${data}`);
  });

  serverProcess.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle IPC messages from renderer
ipcMain.handle('get-app-path', () => {
  return app.getPath('userData');
});