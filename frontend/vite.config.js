import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    // Written directly into backend/ rather than frontend/dist, so the
    // backend can serve it as a plain sibling directory of src/ (see
    // backend/src/server.js) and the existing deploy workflow's zip of
    // backend/ picks it up with no path-layout changes needed.
    outDir: "../backend/public",
    emptyOutDir: true,
  },
});
