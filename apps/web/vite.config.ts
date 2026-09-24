import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

const backendUrl = `http://127.0.0.1:${process.env.TESCORD_E2E_BACKEND_PORT || "3001"}`;
const gatewayUrl = `ws://127.0.0.1:${process.env.TESCORD_E2E_BACKEND_PORT || "3001"}`;

const proxyConfig = {
  "/api": {
    target: backendUrl,
    changeOrigin: true,
  },
  "/gateway": {
    target: gatewayUrl,
    ws: true,
    configure: (proxy: any) => {
      proxy.on("error", (err: any) => {
        if (err?.code === "ECONNRESET") return;
        console.warn("[vite] gateway proxy warning:", err?.message);
      });
    },
  },
  "/uploads": {
    target: backendUrl,
    changeOrigin: true,
  },
  "/attachments": {
    target: backendUrl,
    changeOrigin: true,
  },
  "/public-assets": {
    target: backendUrl,
    changeOrigin: true,
  },
  "/minio": {
    target: "http://127.0.0.1:9000",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/minio/, ""),
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
