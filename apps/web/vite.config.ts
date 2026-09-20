import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  base: "./",
  plugins: [react(), basicSsl()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/gateway": {
        target: "ws://localhost:3001",
        ws: true,
      },
      "/uploads": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/rtc": {
        target: "http://localhost:7880",
        ws: true,
        changeOrigin: true,
      },
      "/twirp": {
        target: "http://localhost:7880",
        changeOrigin: true,
      },
    },
  },
});
