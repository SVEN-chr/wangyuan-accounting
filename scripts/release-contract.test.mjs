import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createUpdaterManifest,
  verifyReleaseContract,
} from "./release-contract.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PROJECT_VERSION = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"),
).version;
const tempRoots = [];

function createProjectFixture({
  packageVersion = "1.2.3",
  cargoVersion = packageVersion,
  tauriVersion = "../package.json",
  endpointRepository = "example/books",
} = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "wangyuan-release-contract-"),
  );
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, "src-tauri"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: packageVersion }),
  );
  fs.writeFileSync(
    path.join(root, "src-tauri", "tauri.conf.json"),
    JSON.stringify({
      version: tauriVersion,
      plugins: {
        updater: {
          endpoints: [
            `https://mirror.example/https://github.com/${endpointRepository}/releases/latest/download/latest.json`,
          ],
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(root, "src-tauri", "Cargo.toml"),
    `[package]\nname = "books"\nversion = "${cargoVersion}"\n`,
  );
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("发布契约", () => {
  it("当前仓库以 package.json 作为唯一发布版本来源", () => {
    expect(
      verifyReleaseContract({
        root: PROJECT_ROOT,
        releaseTag: `v${PROJECT_VERSION}`,
        repository: "SVEN-chr/wangyuan-accounting",
      }),
    ).toMatchObject({
      version: PROJECT_VERSION,
      repository: "SVEN-chr/wangyuan-accounting",
      primaryMirror: "https://ghfast.top/",
    });
  });

  it("Cargo package 是文件最后一节时仍能读取版本", () => {
    expect(
      verifyReleaseContract({
        root: createProjectFixture(),
        releaseTag: "v1.2.3",
        repository: "example/books",
      }).version,
    ).toBe("1.2.3");
  });

  it("拒绝 Cargo 版本偏离唯一版本来源", () => {
    expect(() =>
      verifyReleaseContract({
        root: createProjectFixture({ cargoVersion: "1.2.4" }),
        releaseTag: "v1.2.3",
        repository: "example/books",
      }),
    ).toThrow(/Cargo\.toml.*1\.2\.4.*package\.json.*1\.2\.3/);
  });

  it("拒绝 tauri.conf.json 重新复制版本字面量", () => {
    expect(() =>
      verifyReleaseContract({
        root: createProjectFixture({ tauriVersion: "1.2.3" }),
        releaseTag: "v1.2.3",
        repository: "example/books",
      }),
    ).toThrow(/tauri\.conf\.json.*引用.*package\.json/);
  });

  it("拒绝缺少 v 前缀或版本错误的发布标签", () => {
    expect(() =>
      verifyReleaseContract({
        root: createProjectFixture(),
        releaseTag: "1.2.3",
        repository: "example/books",
      }),
    ).toThrow(/标签.*v1\.2\.3/);
  });

  it("拒绝运行仓库与 updater endpoint 指向不同仓库", () => {
    expect(() =>
      verifyReleaseContract({
        root: createProjectFixture(),
        releaseTag: "v1.2.3",
        repository: "other/books",
      }),
    ).toThrow(/运行仓库.*other\/books.*example\/books/);
  });

  it("使用实际发布资产和首镜像生成 Windows 更新清单", () => {
    expect(
      createUpdaterManifest({
        contract: {
          version: "0.1.7",
          repository: "SVEN-chr/wangyuan-accounting",
          primaryMirror: "https://ghfast.top/",
        },
        releaseTag: "v0.1.7",
        assetNames: ["release-notes.txt", "_0.1.7_x64-setup.exe"],
        signatures: [
          {
            name: "王源专属记账工作台_0.1.7_x64-setup.exe.sig",
            content: "BASE64-SIGNATURE\r\n",
          },
        ],
        publishedAt: "2026-07-29T01:02:03Z",
      }),
    ).toEqual({
      version: "0.1.7",
      pub_date: "2026-07-29T01:02:03Z",
      platforms: {
        "windows-x86_64": {
          signature: "BASE64-SIGNATURE",
          url: "https://ghfast.top/https://github.com/SVEN-chr/wangyuan-accounting/releases/download/v0.1.7/_0.1.7_x64-setup.exe",
        },
      },
    });
  });

  it("拒绝包含多个 Windows 安装包的发布", () => {
    expect(() =>
      createUpdaterManifest({
        contract: {
          version: "0.1.7",
          repository: "SVEN-chr/wangyuan-accounting",
          primaryMirror: "https://ghfast.top/",
        },
        releaseTag: "v0.1.7",
        assetNames: ["first-setup.exe", "second-setup.exe"],
        signatures: [
          { name: "local-setup.exe.sig", content: "SIGNATURE" },
        ],
        publishedAt: "2026-07-29T01:02:03Z",
      }),
    ).toThrow(/恰好一个.*安装包/);
  });

  it("拒绝构建目录中的多个 Windows 更新签名", () => {
    expect(() =>
      createUpdaterManifest({
        contract: {
          version: "0.1.7",
          repository: "SVEN-chr/wangyuan-accounting",
          primaryMirror: "https://ghfast.top/",
        },
        releaseTag: "v0.1.7",
        assetNames: ["only-setup.exe"],
        signatures: [
          { name: "first-setup.exe.sig", content: "FIRST" },
          { name: "second-setup.exe.sig", content: "SECOND" },
        ],
        publishedAt: "2026-07-29T01:02:03Z",
      }),
    ).toThrow(/恰好一个.*签名/);
  });

  it("拒绝 updater 无法解析的发布时间", () => {
    expect(() =>
      createUpdaterManifest({
        contract: {
          version: "0.1.7",
          repository: "SVEN-chr/wangyuan-accounting",
          primaryMirror: "https://ghfast.top/",
        },
        releaseTag: "v0.1.7",
        assetNames: ["only-setup.exe"],
        signatures: [
          { name: "only-setup.exe.sig", content: "SIGNATURE" },
        ],
        publishedAt: "not-a-date",
      }),
    ).toThrow(/发布时间/);
  });
});
