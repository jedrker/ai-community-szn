import { describe, expect, it } from "vitest";

import { pickKvCredentials } from "./credentials";

/** A reader over a literal environment, treating "" as absent like the real readers do. */
function from(env: Record<string, string>) {
  return (name: string) => (env[name] ? env[name] : undefined);
}

describe("pickKvCredentials", () => {
  it("prefers the prefixed pair production injects over a stale unprefixed one", () => {
    expect(
      pickKvCredentials(
        from({
          aicommunity_KV_REST_API_URL: "https://new.upstash.io",
          aicommunity_KV_REST_API_TOKEN: "new-token",
          KV_REST_API_URL: "https://old.upstash.io",
          KV_REST_API_TOKEN: "old-token",
        }),
      ),
    ).toEqual({ url: "https://new.upstash.io", token: "new-token" });
  });

  it("falls back to the unprefixed pair, then to the UPSTASH_ pair", () => {
    expect(
      pickKvCredentials(
        from({
          KV_REST_API_URL: "https://kv.upstash.io",
          KV_REST_API_TOKEN: "kv",
        }),
      ),
    ).toEqual({ url: "https://kv.upstash.io", token: "kv" });
    expect(
      pickKvCredentials(
        from({
          UPSTASH_REDIS_REST_URL: "https://up.upstash.io",
          UPSTASH_REDIS_REST_TOKEN: "up",
        }),
      ),
    ).toEqual({ url: "https://up.upstash.io", token: "up" });
  });

  it("never pairs a URL from one store with a token from another", () => {
    expect(
      pickKvCredentials(
        from({
          aicommunity_KV_REST_API_URL: "https://new.upstash.io",
          KV_REST_API_URL: "https://old.upstash.io",
          KV_REST_API_TOKEN: "old-token",
        }),
      ),
    ).toEqual({ url: "https://old.upstash.io", token: "old-token" });
  });

  it("is null when no pair is complete", () => {
    expect(
      pickKvCredentials(
        from({ aicommunity_KV_REST_API_URL: "https://x.upstash.io" }),
      ),
    ).toBeNull();
  });
});
