/**
 * Node.js/Bun/Deno crypto utilities
 * This module should only be imported in server environments
 */
import { HashAlgorithm } from "featurehub-javascript-core-sdk";

/**
 * A lowercase hex digest, the encoding the protocol requires for the contextSha.
 */
export const createHexHash = async (algorithm: HashAlgorithm, data: string): Promise<string> => {
  const crypto = await import("crypto");
  return crypto.createHash(algorithm).update(data, "utf8").digest("hex");
};
