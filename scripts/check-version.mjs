import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function capture(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`无法读取 ${label} 版本`);
  return match[1];
}

export function readProjectVersions(root) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const tauriConfig = JSON.parse(
    fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
  );
  const cargoToml = fs.readFileSync(
    path.join(root, "src-tauri", "Cargo.toml"),
    "utf8",
  );
  const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

  return {
    packageJson: packageJson.version,
    tauriConfig: tauriConfig.version,
    cargoToml: capture(
      cargoToml,
      /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
      "Cargo.toml",
    ),
    appFallback: capture(
      appSource,
      /const APP_VERSION\s*=\s*"([^"]+)"/,
      "App.tsx APP_VERSION",
    ),
  };
}

export function assertVersionMatch(releaseTag, versions) {
  const entries = Object.entries(versions);
  const expected = entries[0]?.[1];
  const mismatches = entries.filter(([, version]) => version !== expected);
  if (!expected || mismatches.length > 0) {
    throw new Error(`应用版本不一致：${JSON.stringify(versions)}`);
  }

  if (releaseTag && releaseTag !== `v${expected}`) {
    throw new Error(
      `发布标签 ${releaseTag} 与应用版本 ${expected} 不一致；标签必须为 v${expected}：${JSON.stringify(versions)}`,
    );
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const versions = readProjectVersions(process.cwd());
  assertVersionMatch(process.argv[2] ?? "", versions);
  process.stdout.write(`版本校验通过：${versions.packageJson}\n`);
}
