import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CLI_PATH = path.join(PROJECT_ROOT, "scripts", "release-cli.mjs");
const PROJECT_VERSION = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"),
).version;
const PROJECT_TAG = `v${PROJECT_VERSION}`;
const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("发布命令行 adapter", () => {
  it("可以对当前仓库执行显式发布检查", () => {
    expect(
      execFileSync(
        process.execPath,
        [CLI_PATH, "check", PROJECT_TAG, "SVEN-chr/wangyuan-accounting"],
        { cwd: PROJECT_ROOT, encoding: "utf8" },
      ).trim(),
    ).toBe(`发布契约校验通过：${PROJECT_VERSION}`);
  });

  it("无发布 tag 的 artifact 构建仍能保留仓库参数", () => {
    expect(
      execFileSync(
        process.execPath,
        [
          CLI_PATH,
          "check",
          "--tag=",
          "--repository=SVEN-chr/wangyuan-accounting",
        ],
        { cwd: PROJECT_ROOT, encoding: "utf8" },
      ).trim(),
    ).toBe(`发布契约校验通过：${PROJECT_VERSION}`);
  });

  it("从实际资产清单和本地签名生成无 BOM 的 latest.json", () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "wangyuan-release-cli-"),
    );
    tempRoots.push(tempRoot);
    const bundleDir = path.join(tempRoot, "bundle");
    const assetsPath = path.join(tempRoot, "assets.json");
    const outputPath = path.join(tempRoot, "latest.json");
    fs.mkdirSync(bundleDir);
    fs.writeFileSync(
      assetsPath,
      JSON.stringify({
        assets: [{ name: `_${PROJECT_VERSION}_x64-setup.exe` }],
      }),
    );
    fs.writeFileSync(
      path.join(
        bundleDir,
        `王源专属记账工作台_${PROJECT_VERSION}_x64-setup.exe.sig`,
      ),
      "BASE64-SIGNATURE\r\n",
    );

    execFileSync(
      process.execPath,
      [
        CLI_PATH,
        "manifest",
        PROJECT_TAG,
        "SVEN-chr/wangyuan-accounting",
        assetsPath,
        bundleDir,
        outputPath,
        "2026-07-29T01:02:03Z",
      ],
      { cwd: PROJECT_ROOT, encoding: "utf8" },
    );

    const bytes = fs.readFileSync(outputPath);
    expect(bytes[0]).toBe("{".charCodeAt(0));
    expect(JSON.parse(bytes.toString("utf8"))).toMatchObject({
      version: PROJECT_VERSION,
      pub_date: "2026-07-29T01:02:03Z",
      platforms: {
        "windows-x86_64": {
          signature: "BASE64-SIGNATURE",
          url:
            "https://ghfast.top/https://github.com/" +
            `SVEN-chr/wangyuan-accounting/releases/download/${PROJECT_TAG}/_${PROJECT_VERSION}_x64-setup.exe`,
        },
      },
    });
  });
});
