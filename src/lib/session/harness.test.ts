import { afterEach, describe, expect, it, vi } from "vitest";

import { isHarnessEnabled } from "./harness";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isHarnessEnabled", () => {
  it("is off when the flag is unset — the production state", () => {
    vi.stubEnv("LIVEQUIZ_HARNESS", "");
    expect(isHarnessEnabled()).toBe(false);
  });

  it("is on when the flag is set", () => {
    vi.stubEnv("LIVEQUIZ_HARNESS", "1");
    expect(isHarnessEnabled()).toBe(true);
  });

  /**
   * "0" and "false" are what someone writes when they mean off. Treating them as
   * on would be a nasty way to expose a harness that sends the host secret from
   * the browser.
   */
  it.each(["0", "false"])("treats %s as off", (value) => {
    vi.stubEnv("LIVEQUIZ_HARNESS", value);
    expect(isHarnessEnabled()).toBe(false);
  });
});
