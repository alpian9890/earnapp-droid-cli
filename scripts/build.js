#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "src", "earndroid.js");
const distDir = path.join(root, "dist");
const buildDir = path.join(root, "build");
const releaseDir = path.join(root, "release");
const bundle = path.join(distDir, "earndroid.bundle.js");
const obfuscated = path.join(distDir, "earndroid.obf.js");
const defaultArch = process.arch === "arm64" ? "arm64" : "x64";
const target = process.env.PKG_TARGET || `node18-linux-${defaultArch}`;
const releaseTargets = [
  ["node18-linux-x64", "earndroid-linux-amd64"],
  ["node18-linux-arm64", "earndroid-linux-arm64"],
];

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function binPath(name) {
  const ext = process.platform === "win32" ? ".cmd" : "";
  return path.join(root, "node_modules", ".bin", name + ext);
}

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(releaseDir, { recursive: true });
fs.copyFileSync(src, bundle);
fs.chmodSync(bundle, 0o755);

const obfuscator = binPath("javascript-obfuscator");
if (fs.existsSync(obfuscator)) {
  run(obfuscator, [
    bundle,
    "--output",
    obfuscated,
    "--compact",
    "true",
    "--control-flow-flattening",
    "true",
    "--dead-code-injection",
    "true",
    "--identifier-names-generator",
    "hexadecimal",
    "--string-array",
    "true",
    "--string-array-encoding",
    "base64",
    "--string-array-threshold",
    "0.85",
    "--ignore-imports",
    "true",
  ]);
} else {
  fs.copyFileSync(bundle, obfuscated);
}
fs.chmodSync(obfuscated, 0o755);

const pkg = binPath("pkg");
if (!fs.existsSync(pkg)) {
  console.error("Error: pkg binary tidak ditemukan. Jalankan `npm install` lebih dulu.");
  process.exit(1);
}

if (process.env.BUILD_RELEASE === "1") {
  for (const [releaseTarget, fileName] of releaseTargets) {
    const output = path.join(releaseDir, fileName);
    run(pkg, [obfuscated, "--targets", releaseTarget, "--output", output]);
    fs.chmodSync(output, 0o755);
    console.log(`Binary dibuat: release/${fileName}`);
  }
} else {
  const output = path.join(buildDir, "earndroid");
  run(pkg, [obfuscated, "--targets", target, "--output", output]);
  fs.chmodSync(output, 0o755);
  console.log("Binary dibuat: build/earndroid");
}

