import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend dev server proxies /api -> backend on :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
