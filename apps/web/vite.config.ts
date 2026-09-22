import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

const proxyConfig = {
  "/api": {
    target: "http://127.0.0.1:3001",
    changeOrigin: true,
  },
  "/gateway": {
    target: "ws://127.0.0.1:3001",
    ws: true,
    configure: (proxy: any) => {
      proxy.on("error", (err: any) => {
        if (err?.code === "ECONNRESET") return;
        console.warn("[vite] gateway proxy warning:", err?.message);
      });
    },
  },
  "/uploads": {
    target: "http://127.0.0.1:3001",
    changeOrigin: true,
  },
  "/rtc": {
    target: "http://127.0.0.1:7880",
    ws: true,
    changeOrigin: true,
    configure: (proxy: any) => {
      proxy.on("error", (err: any) => {
        if (err?.code === "ECONNRESET") return;
        console.warn("[vite] rtc proxy warning:", err?.message);
      });
    },
  },
  "/twirp": {
    target: "http://127.0.0.1:7880",
    changeOrigin: true,
  },
};

export default defineConfig({
  base: "./",
  plugins: [react(), basicSsl()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: proxyConfig,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    proxy: proxyConfig,
  },
});
