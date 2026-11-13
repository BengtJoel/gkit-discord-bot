import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Locale files + i18n core are shared with the bot
  resolve: { alias: { "@i18n": fileURLToPath(new URL("../server/src/i18n", import.meta.url)) } },
  server: {
    port: 5173,
    // In dev the API runs on :3000 — log in via http://localhost:3000/api/auth/login once, then use :5173
    proxy: { "/api": "http://localhost:3000" },
  },
});
