import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";

import { createHexHash } from "../crypto-browser";

describe("the browser polling hash", () => {
  it("still gives the contextSha in a page with no crypto.subtle (not a secure context)", async () => {
    // browsers leave crypto.subtle out of pages served over plain http
    vi.stubGlobal("crypto", {});
    try {
      const header = "country=thailand,userkey=lingling%20kwong";
      expect(await createHexHash("sha256", header)).toBe(
        createHash("sha256").update(header).digest("hex"),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses an algorithm it does not know", async () => {
    await expect(createHexHash("md5", "orm")).rejects.toThrow("Unsupported hash algorithm: md5");
  });
});
