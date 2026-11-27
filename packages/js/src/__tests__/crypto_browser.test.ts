import { Substitute } from "@fluffy-spoon/substitute";
import { createHash } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHexHash } from "../crypto-browser";
import {
  contextSha,
  type FeatureHubConfig,
  FeatureHubEventSourceClient,
  type InternalFeatureRepository,
  xFeatureHubHeader,
} from "../index";
import { sha256Hex } from "../sha256";

const nodeSha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// featurehub-protocol.yaml encoding.evaluation_context.context_sha.examples
const specVectors: Array<{ attributes: Record<string, string[]>; contextSha: string }> = [
  {
    attributes: { userkey: ["fred"], country: ["nz"] },
    contextSha: "bbaf44b81bc349603f38ece814e9b741fea50e58990db3bd24988ee69eec0603",
  },
  {
    attributes: { city: ["Zürich"], greeting: ["สวัสดี"] },
    contextSha: "d0f83f10b3e4f06cc9e3d57736c75f91dce1f16ed6035f0b430ccd7f37a50dce",
  },
];

// browsers leave crypto.subtle out of pages that are not a secure context (served over plain http)
const withoutWebCrypto = () => vi.stubGlobal("crypto", {});

describe("the browser's hash", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives the spec's contextSha with and without crypto.subtle", async () => {
    for (const vector of specVectors) {
      const header = xFeatureHubHeader(vector.attributes);
      expect(await contextSha(header, createHexHash)).toBe(vector.contextSha);
    }

    withoutWebCrypto();
    for (const vector of specVectors) {
      const header = xFeatureHubHeader(vector.attributes);
      expect(await contextSha(header, createHexHash)).toBe(vector.contextSha);
    }
  });

  it("refuses an algorithm it does not know", async () => {
    await expect(createHexHash("md5", "orm")).rejects.toThrow("Unsupported hash algorithm: md5");
  });

  it("is what streaming hashes the context with, so it works in a page with no crypto.subtle", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "EventSource",
      class {
        constructor(url: string) {
          urls.push(url);
        }

        addEventListener() {}

        close() {}
      },
    );
    withoutWebCrypto();
    const config = Substitute.for<FeatureHubConfig>();
    config.url().returns("http://localhost/features/default/ormkorn");
    config.clientEvaluated().returns(false);
    const header = "userkey=kornaphat";

    await new FeatureHubEventSourceClient(
      config,
      Substitute.for<InternalFeatureRepository>(),
    ).contextChange(header);

    expect(FeatureHubEventSourceClient.contextHash).toBe(createHexHash);
    expect(urls).toEqual([
      `http://localhost/features/default/ormkorn?contextSha=${nodeSha256(header)}&sdk_version=2&xfeaturehub=${encodeURIComponent(header)}`,
    ]);
  });
});

describe("the JavaScript SHA-256", () => {
  it("computes the same SHA-256 as Node's crypto, across block boundaries and for any text", () => {
    const texts = ["", "abc", "หลิงหลิง ศิริลักษณ์ คอง", "鄺玲玲 omu&co 🎂"];
    // 55, 56 and 64 bytes are where the padding needs another block
    for (let n = 0; n <= 200; n++) texts.push("o".repeat(n));

    for (const text of texts) {
      expect(sha256Hex(text)).toBe(nodeSha256(text));
    }
  });
});
