// Wrapper do build do frontend.
//
// Motivo: neste ambiente o esbuild falha ao remover temporários na pasta TEMP
// padrão do Windows ("Access is denied"), e o mesmo já acontecia nos builds
// anteriores deste projeto. Redirecionar TEMP/TMP para .tmp/ resolve.
// É o mesmo padrão usado por build.cjs no empacotamento Tauri.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = __dirname;
const tempDir = path.join(root, ".tmp", "vite-build-temp");
fs.mkdirSync(tempDir, { recursive: true });

const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
if (!fs.existsSync(viteBin)) {
  console.error(`Vite não encontrado em ${viteBin}. Rode "npm ci" antes do build.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [viteBin, "build", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, TEMP: tempDir, TMP: tempDir },
});

if (result.error) {
  console.error(`Falha ao iniciar o build: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
