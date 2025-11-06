/**
 * Cross-platform crypto utilities
 * Automatically selects the appropriate implementation based on environment
 */

import { isBrowser } from "../utils";
import type { HashAlgorithm } from "./types";

// Type-only imports to avoid bundling issues
type CryptoModule = {
  createBase64UrlSafeHash: (algorithm: HashAlgorithm, data: string) => Promise<string>;
};

let cryptoModule: CryptoModule | null = null;

const getCryptoModule = async (): Promise<CryptoModule> => {
  if (cryptoModule) return cryptoModule;

  if (isBrowser()) {
    // Dynamic import that won't be included in server bundles
    cryptoModule = await import("./crypto-browser");
  } else {
    // Dynamic import that won't be included in browser bundles when using proper bundler config
    cryptoModule = await import("./crypto-node");
  }

  return cryptoModule;
};

export const createBase64UrlSafeHash = async (
  algorithm: HashAlgorithm,
  data: string,
): Promise<string> => {
  const crypto = await getCryptoModule();
  return crypto.createBase64UrlSafeHash(algorithm, data);
};
