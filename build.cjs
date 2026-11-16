const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const tmp = path.resolve(__dirname, ".tmp");
fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(path.join(__dirname, "src-tauri", ".tmp"), { recursive: true });

process.env.TEMP = tmp;
process.env.TMP = tmp;

try {
  execSync("tauri build", { stdio: "inherit", env: process.env });
} catch (e) {
  process.exit(1);
}
