import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Firefox portu: Vite SADECE popup + options (React) için.
// content/background IIFE çıktısı build.js içinde esbuild ile üretilir.
export default defineConfig({
  plugins: [react()],
  // Eklenti sayfaları sunucudan değil dosyadan yüklenir → göreli asset yolları şart.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "firefox115",
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
        options: resolve(__dirname, "src/options/index.html"),
      },
    },
  },
});
