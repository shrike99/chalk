import { defineConfig } from "vite";
import { resolve } from "node:path";

// Two pages: the app, and the A4 document renderer (previewed in an iframe, printed to PDF).
// In development, /api calls are forwarded to the Python backend on port 8000.
export default defineConfig({
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, "index.html"), paper: resolve(__dirname, "paper.html") },
    },
  },
});
