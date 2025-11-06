/**
 * Node.js/Bun/Deno crypto utilities
 * This module should only be imported in server environments
 */

import type { HashAlgorithm } from "./types";

export const createBase64UrlSafeHash = async (
  algorithm: HashAlgorithm,
  data: string,
): Promise<string> => {
  const crypto = await import("crypto");
  const hash = crypto.createHash(algorithm).update(data).digest("base64");

  // Convert to base64 url encoding (no padding)
  return hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
