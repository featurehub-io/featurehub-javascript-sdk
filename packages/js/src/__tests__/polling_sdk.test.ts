import { Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import type { FeatureEnvironmentCollection } from "featurehub-javascript-core-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BrowserPollingService,
  type FeatureHubConfig,
  FeatureHubPollingClient,
  FHLog,
  PollingBase,
  type PollingService,
} from "../index";

describe("basic polling sdk works as expected", () => {
  let poller: SubstituteOf<PollingService>;
  let config: SubstituteOf<FeatureHubConfig>;

  beforeEach(() => {
    poller = Substitute.for<PollingBase>();

    poller.busy.returns?.(false);

    FeatureHubPollingClient.pollingClientProvider = () => poller;

    FHLog.fhLog.trace = (...args: any[]) => {
      console.log("FeatureHub/Trace: ", ...args);
    };

    config = Substitute.for<FeatureHubConfig>();
    config.getHost().returns("http://localhost/");
    config.getApiKeys().returns(["12344"]);
  });

  describe("attributeHeader hashing", () => {
    const TEST_HASH = "n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg";
    const USER_ID_HASH = "F7827sASf1GewZfMvDzBlYpLnaFcKM0xchzNEElvh94";
    const SESSION_HASH = "ZJ2mGsLI7CqpUgmQqueaBudcjnxW6SZ9uVuwMWASoe4";

    let dom: any;
    let originalWindow: any;
    let originalDocument: any;
    let originalStorage: any;
    let storage: any;

    beforeAll(async () => {
      // Create JSDOM environment to simulate browser
      const { JSDOM } = await import("jsdom");
      dom = new JSDOM("", {
        url: "https://localhost",
        pretendToBeVisual: true,
        resources: "usable",
      });

      storage = {};

      // Store original window
      originalWindow = (globalThis as any).window;
      originalDocument = (globalThis as any).document;
      originalStorage = (globalThis as any).localStorage;

      // Set up browser-like environment
      (globalThis as any).window = dom.window;
      (globalThis as any).localStorage = {
        getItem: (key: string) => storage![key],
        setItem: (key: string, val: any) => (storage![key] = val),
      };

      Object.defineProperty(globalThis, "window", {
        value: dom.window,
        writable: true,
        configurable: true,
      });

      const { webcrypto } = await import("crypto");
      Object.defineProperty(globalThis.window, "crypto", {
        value: {
          ...webcrypto,
          subtle: webcrypto.subtle,
        },
        writable: true,
        configurable: true,
      });
    });

    afterAll(() => {
      // Restore original window
      (globalThis as any).window = originalWindow;
      (globalThis as any).document = originalDocument;
      (globalThis as any).localStorage = originalStorage;
      dom.window.close();
    });

    it("should produce consistent hash results for context headers", async () => {
      const { createBase64UrlSafeHash } = await import("../crypto-browser");

      class TestPoller extends PollingBase {
        constructor() {
          super("http://localhost", 0, createBase64UrlSafeHash, {}, () => {});
        }

        override poll(): Promise<void> {
          return Promise.resolve();
        }

        // Expose the protected _shaHeader for testing
        get shaHeader(): string {
          return this._shaHeader;
        }
      }

      const testPoller = new TestPoller();

      // Test known hash values to ensure consistency
      await testPoller.attributeHeader("");
      expect(testPoller.shaHeader).toBe("0");

      await testPoller.attributeHeader("test");
      expect(testPoller.shaHeader).toBe(TEST_HASH);

      await testPoller.attributeHeader("user-id:12345");
      expect(testPoller.shaHeader).toBe(USER_ID_HASH);

      await testPoller.attributeHeader("user-id:12345,session:abcdef");
      expect(testPoller.shaHeader).toBe(SESSION_HASH);
    });

    it("produces same hash results in browser environment as node environment", async () => {
      const { createBase64UrlSafeHash } = await import("../crypto-browser");

      const testHash = await createBase64UrlSafeHash("sha256", "test");
      expect(testHash).toBe(TEST_HASH);

      const userIdHash = await createBase64UrlSafeHash("sha256", "user-id:12345");
      expect(userIdHash).toBe(USER_ID_HASH);

      const sessionHash = await createBase64UrlSafeHash("sha256", "user-id:12345,session:abcdef");
      expect(sessionHash).toBe(SESSION_HASH);
    });

    it("should not actually attempt to poll if it is within the frequency window", async () => {
      let features: Array<FeatureEnvironmentCollection> | undefined = undefined;
      let src: string | undefined = undefined;

      storage["http://localhost"] = JSON.stringify({ e: [], tz: Date.now() + 1000 });
      const bp = new BrowserPollingService({}, "http://localhost", 3000, (e, s) => {
        features = e;
        src = s;
      });

      let result = await bp.preload(Substitute.for(), "http://localhost");
      expect(result).to.be.true;
      expect(src).to.eq("browser-store");
      expect(features!.length).eq(0);

      // when the timer exceeds the threshold, it should return false and let us poll

      storage["http://localhost"] = JSON.stringify({ e: [], tz: Date.now() + 3001 });
      result = await bp.preload(Substitute.for(), "http://localhost");
      expect(result).to.be.false;
    });
  });
});
