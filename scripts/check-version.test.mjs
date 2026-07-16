import { describe, expect, it } from "vitest";
import { assertVersionMatch } from "./check-version.mjs";

describe("发布版本门禁", () => {
  it("拒绝 tag 与应用版本不一致的发布", () => {
    expect(() =>
      assertVersionMatch("v0.1.8", {
        packageJson: "0.1.7",
        tauriConfig: "0.1.7",
        cargoToml: "0.1.7",
        appFallback: "0.1.7",
      }),
    ).toThrow(/v0\.1\.8.*0\.1\.7/);
  });

  it("拒绝缺少 v 前缀的手动发布标签", () => {
    expect(() =>
      assertVersionMatch("0.1.7", {
        packageJson: "0.1.7",
        tauriConfig: "0.1.7",
        cargoToml: "0.1.7",
        appFallback: "0.1.7",
      }),
    ).toThrow(/必须为 v0\.1\.7/);
  });
});
