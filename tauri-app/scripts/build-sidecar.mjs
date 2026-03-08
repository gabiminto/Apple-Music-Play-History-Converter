import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tauriRoot = path.resolve(__dirname, "..");
const sidecarDir = path.join(tauriRoot, "python-sidecar");
const venvDir = path.join(sidecarDir, ".bundle-venv");
const requirementsPath = path.join(sidecarDir, "requirements.txt");
const specPath = path.join(sidecarDir, "sidecar.spec");
const distDir = path.join(sidecarDir, "dist");
const buildDir = path.join(sidecarDir, "build");
const pyInstallerMarker = process.platform === "win32"
  ? path.join(venvDir, "Scripts", "pyinstaller.exe")
  : path.join(venvDir, "bin", "pyinstaller");
const venvPython = process.platform === "win32"
  ? path.join(venvDir, "Scripts", "python.exe")
  : path.join(venvDir, "bin", "python");
const outputBinary = process.platform === "win32"
  ? path.join(distDir, "sidecar.exe")
  : path.join(distDir, "sidecar");

function run(command, args, options = {}) {
  const display = [command, ...args].join(" ");
  console.log(`[build-sidecar] ${display}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? "unknown"}): ${display}`);
  }
}

function findPython() {
  const candidates = process.platform === "win32"
    ? [
        ["py", ["-3"]],
        ["python", []],
        ["python3", []],
      ]
    : [
        ["python3", []],
        ["python", []],
      ];

  for (const [command, baseArgs] of candidates) {
    const probe = spawnSync(command, [...baseArgs, "--version"], { encoding: "utf8" });
    if (probe.status === 0) {
      return { command, baseArgs };
    }
  }

  return null;
}

function ensureVenv(python) {
  if (!existsSync(venvPython)) {
    run(python.command, [...python.baseArgs, "-m", "venv", venvDir], { cwd: sidecarDir });
  }
}

function ensureBuildEnvironment() {
  if (!existsSync(pyInstallerMarker)) {
    run(venvPython, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], { cwd: sidecarDir });
    run(venvPython, ["-m", "pip", "install", "-r", requirementsPath, "pyinstaller"], { cwd: sidecarDir });
  } else {
    run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", requirementsPath], { cwd: sidecarDir });
  }
}

function cleanBuildArtifacts() {
  rmSync(buildDir, { recursive: true, force: true });
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
}

function signMacSidecar() {
  if (process.platform !== "darwin") {
    return;
  }

  const identity = process.env.APPLE_SIGNING_IDENTITY?.trim() || "-";
  const args = ["--force", "--sign", identity];

  if (identity !== "-") {
    args.push("--options", "runtime", "--timestamp");
  }

  args.push(outputBinary);
  run("codesign", args, { cwd: sidecarDir });
}

function main() {
  if (!["darwin", "win32"].includes(process.platform)) {
    console.log(`[build-sidecar] Skipping bundled sidecar build on unsupported platform: ${process.platform}`);
    return;
  }

  if (!existsSync(specPath)) {
    throw new Error(`Missing PyInstaller spec: ${specPath}`);
  }

  const python = findPython();
  if (!python) {
    throw new Error("Python 3.8+ is required to build the bundled sidecar");
  }

  ensureVenv(python);
  ensureBuildEnvironment();
  cleanBuildArtifacts();

  run(venvPython, ["-m", "PyInstaller", "--noconfirm", specPath], { cwd: sidecarDir });

  if (!existsSync(outputBinary)) {
    throw new Error(`Bundled sidecar binary was not created at ${outputBinary}`);
  }

  signMacSidecar();
  console.log(`[build-sidecar] Bundled sidecar ready: ${outputBinary}`);
}

main();
