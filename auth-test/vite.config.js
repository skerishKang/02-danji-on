import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "localhost",
    port: 3000,
    proxy: {
      "/api": {
        target: "https://danjion-api-dev.muphobia2.workers.dev",
        changeOrigin: true,
        secure: true,
      },
      "/local-api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(
            /^\/local-api/,
            "/api"
          ),
      },
      "/prod-api": {
        target:
          "https://danjion-api-dev.muphobia2.workers.dev",
        changeOrigin: true,
        secure: true,
        rewrite: (path) =>
          path.replace(
            /^\/prod-api/,
            "/api"
          ),
      },
    },
  },
});