import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    watch: {
      // Editoras gravam de forma atômica criando um `.tmpdir` ao lado do arquivo.
      // O chokidar tenta observar esses diretórios efêmeros e derruba o watcher
      // com EBUSY (Windows). Ignorar o padrão mantém o dev server de pé.
      ignored: ["**/.*.tmpdir/**", "**/*.tmpdir/**", "**/*.tmp"],
    },
  },
  build: {
    target: "es2020",
    minify: "terser",
  },
});
