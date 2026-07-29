import fs from "node:fs";
import path from "node:path";
import {
  createUpdaterManifest,
  verifyReleaseContract,
} from "./release-contract.mjs";

function usage() {
  return [
    "用法：",
    "  node scripts/release-cli.mjs check [release-tag] [repository]",
    "  node scripts/release-cli.mjs manifest <release-tag> <repository> <assets-json> <bundle-dir> <output> [published-at]",
  ].join("\n");
}

function nowWithoutMilliseconds() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function optionValue(args, name) {
  const prefix = `--${name}=`;
  return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const [, , command, ...args] = process.argv;

if (command === "check") {
  const positional = args.filter((argument) => !argument.startsWith("--"));
  const releaseTag = optionValue(args, "tag") ?? positional[0] ?? "";
  const repositoryArg =
    optionValue(args, "repository") ?? positional[1] ?? "";
  const contract = verifyReleaseContract({
    root: process.cwd(),
    releaseTag,
    repository: repositoryArg || process.env.GITHUB_REPOSITORY || "",
  });
  process.stdout.write(`发布契约校验通过：${contract.version}\n`);
} else if (command === "manifest") {
  const [
    releaseTag,
    repository,
    assetsPath,
    bundleDir,
    outputPath,
    publishedAt = nowWithoutMilliseconds(),
  ] = args;
  if (
    !releaseTag ||
    !repository ||
    !assetsPath ||
    !bundleDir ||
    !outputPath
  ) {
    throw new Error(usage());
  }

  const contract = verifyReleaseContract({
    root: process.cwd(),
    releaseTag,
    repository,
  });
  const releaseAssets = JSON.parse(fs.readFileSync(assetsPath, "utf8"));
  const assetNames = Array.isArray(releaseAssets.assets)
    ? releaseAssets.assets.map((asset) => String(asset.name ?? ""))
    : [];
  const signatures = fs
    .readdirSync(bundleDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && entry.name.toLowerCase().endsWith("-setup.exe.sig"),
    )
    .map((entry) => ({
      name: entry.name,
      content: fs.readFileSync(path.join(bundleDir, entry.name), "utf8"),
    }));
  const manifest = createUpdaterManifest({
    contract,
    releaseTag,
    assetNames,
    signatures,
    publishedAt,
  });
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf8");
  process.stdout.write(`更新清单已生成：${path.resolve(outputPath)}\n`);
} else {
  throw new Error(usage());
}
