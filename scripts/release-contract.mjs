import fs from "node:fs";
import path from "node:path";

const GITHUB_LATEST_PATH =
  "releases/latest/download/latest.json";
const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 ${label}：${error instanceof Error ? error.message : String(error)}`);
  }
}

function readCargoVersion(cargoToml) {
  const packageHeader = /^\[package\]\s*$/m.exec(cargoToml);
  if (!packageHeader) throw new Error("无法读取 Cargo.toml [package] 版本");
  const afterHeader = cargoToml.slice(packageHeader.index + packageHeader[0].length);
  const nextSectionIndex = afterHeader.search(/^\[/m);
  const packageSection =
    nextSectionIndex === -1
      ? afterHeader
      : afterHeader.slice(0, nextSectionIndex);
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error("无法读取 Cargo.toml [package] 版本");
  return version;
}

function repositoryFromEndpoint(endpoint) {
  const match = endpoint.match(
    /https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\/latest\.json$/,
  );
  return match?.[1] ?? null;
}

export function verifyReleaseContract({
  root,
  releaseTag = "",
  repository = "",
}) {
  const packagePath = path.resolve(root, "package.json");
  const tauriConfigPath = path.resolve(root, "src-tauri", "tauri.conf.json");
  const cargoPath = path.resolve(root, "src-tauri", "Cargo.toml");
  const packageJson = readJson(packagePath, "package.json");
  const tauriConfig = readJson(tauriConfigPath, "tauri.conf.json");
  const version = String(packageJson.version ?? "");

  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`package.json 版本不是有效 SemVer：${version || "<empty>"}`);
  }

  if (typeof tauriConfig.version !== "string") {
    throw new Error("tauri.conf.json version 必须引用根 package.json");
  }
  const tauriVersionSource = path.resolve(
    path.dirname(tauriConfigPath),
    tauriConfig.version,
  );
  if (tauriVersionSource !== packagePath) {
    throw new Error(
      `tauri.conf.json version 必须引用 ../package.json，当前为 ${tauriConfig.version}`,
    );
  }

  const cargoVersion = readCargoVersion(fs.readFileSync(cargoPath, "utf8"));
  if (cargoVersion !== version) {
    throw new Error(
      `Cargo.toml 版本 ${cargoVersion} 与 package.json 版本 ${version} 不一致`,
    );
  }

  if (releaseTag && releaseTag !== `v${version}`) {
    throw new Error(
      `发布标签 ${releaseTag} 与应用版本 ${version} 不一致；标签必须为 v${version}`,
    );
  }

  const updaterEndpoints = tauriConfig.plugins?.updater?.endpoints;
  if (!Array.isArray(updaterEndpoints) || updaterEndpoints.length === 0) {
    throw new Error("tauri.conf.json 至少需要一个 updater endpoint");
  }
  const endpointRepositories = updaterEndpoints.map((endpoint) =>
    repositoryFromEndpoint(String(endpoint)),
  );
  if (endpointRepositories.some((candidate) => !candidate)) {
    throw new Error("updater endpoint 必须指向 GitHub latest.json");
  }
  const configuredRepository = endpointRepositories[0];
  if (
    endpointRepositories.some(
      (candidate) => candidate !== configuredRepository,
    )
  ) {
    throw new Error("所有 updater endpoint 必须指向同一个 GitHub 仓库");
  }
  if (repository && repository !== configuredRepository) {
    throw new Error(
      `运行仓库 ${repository} 与 updater endpoint 仓库 ${configuredRepository} 不一致`,
    );
  }

  const directLatestUrl =
    `https://github.com/${configuredRepository}/${GITHUB_LATEST_PATH}`;
  const primaryEndpoint = String(updaterEndpoints[0]);
  const primaryMirror = primaryEndpoint.slice(
    0,
    primaryEndpoint.length - directLatestUrl.length,
  );

  return {
    version,
    repository: configuredRepository,
    updaterEndpoints,
    primaryMirror,
  };
}

export function createUpdaterManifest({
  contract,
  releaseTag,
  assetNames,
  signatures,
  publishedAt,
}) {
  if (releaseTag !== `v${contract.version}`) {
    throw new Error(
      `发布标签 ${releaseTag} 与应用版本 ${contract.version} 不一致`,
    );
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(publishedAt) ||
    !Number.isFinite(Date.parse(publishedAt))
  ) {
    throw new Error(`更新清单发布时间无效：${publishedAt}`);
  }
  const installerAssets = assetNames.filter((name) =>
    name.toLowerCase().endsWith("-setup.exe"),
  );
  if (installerAssets.length !== 1) {
    throw new Error(
      `发布中必须恰好一个 *-setup.exe 安装包，实际为 ${installerAssets.length} 个`,
    );
  }
  const [installerAsset] = installerAssets;
  const signatureFiles = signatures.filter((signature) =>
    signature.name.toLowerCase().endsWith("-setup.exe.sig"),
  );
  if (signatureFiles.length !== 1) {
    throw new Error(
      `构建目录中必须恰好一个 *-setup.exe.sig 签名，实际为 ${signatureFiles.length} 个`,
    );
  }
  const [signatureFile] = signatureFiles;
  const signature = signatureFile.content.trim().replace(/\r\n/g, "\n");
  if (!signature) throw new Error("更新签名不能为空");

  return {
    version: contract.version,
    pub_date: publishedAt,
    platforms: {
      "windows-x86_64": {
        signature,
        url:
          `${contract.primaryMirror}https://github.com/` +
          `${contract.repository}/releases/download/${releaseTag}/${encodeURIComponent(installerAsset)}`,
      },
    },
  };
}
