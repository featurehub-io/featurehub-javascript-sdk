import { Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import { beforeEach, describe, expect, it } from "vitest";

import { createHexHash } from "../crypto-node";
import { type FeatureHubConfig, FHLog, PollingBase, type PollingService } from "../index";

describe("basic polling sdk works as expected", () => {
  let poller: SubstituteOf<PollingService>;
  let config: SubstituteOf<FeatureHubConfig>;

  beforeEach(() => {
    poller = Substitute.for<PollingBase>();

    poller.busy.returns?.(false);

    FHLog.fhLog.trace = (...args: any[]) => {
      console.log("FeatureHub/Trace: ", ...args);
    };

    config = Substitute.for<FeatureHubConfig>();
    config.getHost().returns("http://localhost/");
    config.getApiKeys().returns(["12344"]);
  });

  describe("attributeHeader hashing", () => {
    const TEST_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    const USER_ID_HASH = "17bf36eec0127f519ec197ccbc3cc1958a4b9da15c28cd31721ccd10496f87de";
    const SESSION_HASH = "649da61ac2c8ec2aa9520990aae79a06e75c8e7c56e9267db95bb0316012a1ee";

    it("should produce consistent hash results for context headers", async () => {
      class TestPoller extends PollingBase {
        constructor() {
          super("http://localhost", 0, createHexHash, {}, () => {});
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
      const testHash = await createHexHash("sha256", "test");
      expect(testHash).toBe(TEST_HASH);

      const userIdHash = await createHexHash("sha256", "user-id:12345");
      expect(userIdHash).toBe(USER_ID_HASH);

      const sessionHash = await createHexHash("sha256", "user-id:12345,session:abcdef");
      expect(sessionHash).toBe(SESSION_HASH);
    });
  });
});
