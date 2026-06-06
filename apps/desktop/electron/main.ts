// Process principal Electron : crée la fenêtre, charge le renderer (Vite en dev,
// fichier statique en prod).

import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

// __dirname n'existe pas en ESM → on le recrée à partir de import.meta.url
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = !!process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL!);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
