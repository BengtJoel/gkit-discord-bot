import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In dev the API runs on :3000 — log in via http://localhost:3000/api/auth/login once, then use :5173
    proxy: { "/api": "http://localhost:3000" },
  },
});
