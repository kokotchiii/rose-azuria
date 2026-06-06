import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

// Config "simple" de vite-plugin-electron : laisse le plugin gérer
// la compilation TS→JS et le format CJS de Electron correctement.

export default defineConfig({
  // Charger le .env depuis la racine du monorepo (et pas apps/desktop/)
  envDir: "../..",
  plugins: [
    react(),
    electron({
      main: { entry: "electron/main.ts" },
      preload: { input: "electron/preload.ts" },
    }),
  ],
  server: { port: 5173 },
});
