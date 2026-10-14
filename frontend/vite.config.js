import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Solo para `npm run dev` fuera de Docker; en el contenedor el reenvío lo hace Nginx
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        rewrite: (ruta) => ruta.replace(/^\/api/, ""),
      },
    },
  },
});
