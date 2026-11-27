import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";

import type { ContextRecord } from "../client_context";
import { contextSha, xFeatureHubHeader } from "../context_header";
import { sha256Hex } from "../crypto/sha256";

// featurehub-protocol.yaml encoding.evaluation_context.context_sha.examples - every SDK reproduces these
const specVectors: Array<{ attributes: ContextRecord; header: string; contextSha: string }> = [
  { attributes: {}, header: "", contextSha: "0" },
  {
    attributes: { userkey: ["fred"], country: ["nz"] },
    header: "country=nz,userkey=fred",
    contextSha: "bbaf44b81bc349603f38ece814e9b741fea50e58990db3bd24988ee69eec0603",
  },
  {
    attributes: { shop: ["a&b", "c d"] },
    header: "shop=a%26b%2Cc%20d",
    contextSha: "5f2930219932130037f572be9de4ae5cea89983dba663d9400437a63c1dea22c",
  },
  {
    attributes: { "my key": ["x"], "a,b=c": ["y"] },
    header: "a%2Cb%3Dc=y,my%20key=x",
    contextSha: "a9d1b1707b4d38824da99d1daf06a1b9b24f7d1397d0e138153a946f1575d40a",
  },
  {
    attributes: { name: ["Mary Jane+O'Neil ~*()!"] },
    header: "name=Mary%20Jane%2BO'Neil%20~*()!",
    contextSha: "ff5b8c6d2cc3bbebfc3285b9106b3b300082ecfc5db6d1e4e37e685d0dbbe653",
  },
  {
    attributes: { city: ["Zürich"], greeting: ["สวัสดี"] },
    header: "city=Z%C3%BCrich,greeting=%E0%B8%AA%E0%B8%A7%E0%B8%B1%E0%B8%AA%E0%B8%94%E0%B8%B5",
    contextSha: "d0f83f10b3e4f06cc9e3d57736c75f91dce1f16ed6035f0b430ccd7f37a50dce",
  },
  {
    attributes: { "a!": ["1"], "a ": ["2"] },
    header: "a!=1,a%20=2",
    contextSha: "16cab394e891c04ba620debb77279050b6a88e4b58da3bffeb286c4428289e72",
  },
  {
    attributes: { userkey: ["fred"], empty: [], gone: [null as unknown as string] },
    header: "userkey=fred",
    contextSha: "6a1d1fa42d1c1917552a255a940792205cb62cc2efd6613ab5a3f75d0038518b",
  },
  {
    attributes: { version: [3.0], beta: [true], ratio: [0.5] },
    header: "beta=true,ratio=0.5,version=3",
    contextSha: "b8ec246368e079b0f2b84682231065d867c943e964b5d5acfb557c86cb45b0fb",
  },
];

describe("x-featurehub header and contextSha", () => {
  specVectors.forEach((vector) => {
    it(`reproduces the spec vector ${JSON.stringify(vector.attributes)}`, async () => {
      const header = xFeatureHubHeader(vector.attributes);
      expect(header).toBe(vector.header);
      expect(await contextSha(header)).toBe(vector.contextSha);
    });
  });

  it("encodes keys, single values and Thai text the same way as the spec", async () => {
    const header = xFeatureHubHeader({
      userkey: "lingling kwong",
      "kwong pastry": "omu&co",
      name: "หลิงหลิง ศิริลักษณ์ คอง",
      shows: ["always wonder", "keep silent"],
      undefinedAttr: undefined,
    });

    expect(header).toBe(
      [
        "kwong%20pastry=omu%26co",
        `name=${encodeURIComponent("หลิงหลิง ศิริลักษณ์ คอง")}`,
        "shows=always%20wonder%2Ckeep%20silent",
        "userkey=lingling%20kwong",
      ].join(","),
    );
    expect(await contextSha(header)).toBe(createHash("sha256").update(header).digest("hex"));
  });

  it("returns 0 for an empty or missing header rather than hashing it", async () => {
    expect(await contextSha("")).toBe("0");
    expect(await contextSha(undefined)).toBe("0");
  });

  it("is 64 lowercase hex characters otherwise", async () => {
    expect(await contextSha("userkey=orm")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("contextSha without the Web Crypto API", () => {
  it("reproduces the spec vectors when crypto.subtle is missing", async () => {
    // a page that is not a secure context (plain http) has no crypto.subtle
    vi.stubGlobal("crypto", {});
    try {
      for (const vector of specVectors) {
        expect(await contextSha(xFeatureHubHeader(vector.attributes))).toBe(vector.contextSha);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("computes the same SHA-256 as Node's crypto, across block boundaries and for any text", () => {
    const texts = ["", "abc", "หลิงหลิง ศิริลักษณ์ คอง", "鄺玲玲 omu&co 🎂"];
    // 55, 56 and 64 bytes are where the padding needs another block
    for (let n = 0; n <= 200; n++) texts.push("o".repeat(n));

    for (const text of texts) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
    }
  });
});
