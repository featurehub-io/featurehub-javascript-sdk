import type { CoreAnalytics, CoreContext } from "@segment/analytics-core";
import {
  BaseUsageEvent,
  BaseUsageEventWithFeature,
  BaseUsageFeaturesCollection,
  FeatureHubUsageValue,
  FeatureValueType,
} from "featurehub-javascript-core-sdk";
import { describe, expect, it, vi } from "vitest";

import { FeatureHubSegmentEnrichmentPlugin, SegmentUsagePlugin } from "../index";

function makeMockAnalytics(): CoreAnalytics {
  return {
    track: vi.fn(),
    page: vi.fn(),
    identify: vi.fn(),
    group: vi.fn(),
    alias: vi.fn(),
    screen: vi.fn(),
    register: vi.fn().mockResolvedValue(undefined),
    deregister: vi.fn().mockResolvedValue(undefined),
    VERSION: "1.0.0",
  };
}

function makeMockContext(updateEventFn = vi.fn()): CoreContext {
  return { updateEvent: updateEventFn } as unknown as CoreContext;
}

function makeUsageValue(
  key: string,
  rawValue: boolean | string | number | undefined,
  type: FeatureValueType = FeatureValueType.String,
): FeatureHubUsageValue {
  return new FeatureHubUsageValue("id1", key, rawValue, type, "env1", undefined);
}

function makeFeatureEvent(
  key: string,
  rawValue: boolean | string | number | undefined,
  userKey?: string,
): BaseUsageEventWithFeature {
  return new BaseUsageEventWithFeature(makeUsageValue(key, rawValue), undefined, userKey);
}

function makeCollectionEvent(
  keys: Array<{ key: string; rawValue: boolean | string | number | undefined }>,
): BaseUsageFeaturesCollection {
  const event = new BaseUsageFeaturesCollection();
  event.featureValues = keys.map(({ key, rawValue }) => makeUsageValue(key, rawValue));
  return event;
}

describe("SegmentUsagePlugin", () => {
  describe("send — feature event", () => {
    it("calls analytics.track with eventName, anonymous userId, and properties", () => {
      const analytics = makeMockAnalytics();
      const plugin = new SegmentUsagePlugin(() => analytics);

      plugin.send(makeFeatureEvent("MY_FLAG", "hello"));

      expect(analytics.track).toHaveBeenCalledOnce();
      expect(analytics.track).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "feature",
          userId: "anonymous",
          properties: expect.objectContaining({ feature: "MY_FLAG" }),
        }),
      );
    });

    it("uses the event userKey as userId when set", () => {
      const analytics = makeMockAnalytics();
      const plugin = new SegmentUsagePlugin(() => analytics);

      plugin.send(makeFeatureEvent("FLAG", "val", "user-123"));

      expect(analytics.track).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-123" }));
    });

    it("uses the configured anonymous value when userKey is absent", () => {
      const analytics = makeMockAnalytics();
      const plugin = new SegmentUsagePlugin(() => analytics);
      plugin.anonymous = "guest";

      plugin.send(makeFeatureEvent("FLAG", "val"));

      expect(analytics.track).toHaveBeenCalledWith(expect.objectContaining({ userId: "guest" }));
    });

    it("includes feature key, value, id, and environmentId in properties", () => {
      const analytics = makeMockAnalytics();
      const plugin = new SegmentUsagePlugin(() => analytics);

      plugin.send(makeFeatureEvent("PRICE", 9.99));

      const call = (analytics.track as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as any;
      expect(call.properties).toMatchObject({
        feature: "PRICE",
        id: "id1",
        environmentId: "env1",
      });
    });

    it("merges defaultPluginAttributes into properties", () => {
      const analytics = makeMockAnalytics();
      const plugin = new SegmentUsagePlugin(() => analytics);
      plugin.defaultPluginAttributes["service"] = "checkout";
      plugin.defaultPluginAttributes["region"] = "us-east-1";

      plugin.send(makeFeatureEvent("FLAG", true));

      const call = (analytics.track as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as any;
      expect(call.properties).toMatchObject({
        service: "checkout",
        region: "us-east-1",
        feature: "FLAG",
      });
    });

    it("defaultPluginAttributes do not override feature properties", () => {
      const analytics = makeMockAnalytics();
      const plugin = new SegmentUsagePlugin(() => analytics);
      plugin.defaultPluginAttributes["feature"] = "custom";

      plugin.send(makeFeatureEvent("REAL_FLAG", "v"));

      // collectUsageRecord() runs after defaultPluginAttributes merge, so feature key wins
      const call = (analytics.track as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as any;
      expect(call.properties.feature).toBe("REAL_FLAG");
    });
  });

  describe("send — feature-collection event", () => {
    it("calls analytics.track with eventName feature-collection", () => {
      const analytics = makeMockAnalytics();
      const plugin = new SegmentUsagePlugin(() => analytics);

      plugin.send(makeCollectionEvent([{ key: "A", rawValue: "a" }]));

      expect(analytics.track).toHaveBeenCalledWith(
        expect.objectContaining({ event: "feature-collection" }),
      );
    });

    it("includes all feature keys in properties", () => {
      const analytics = makeMockAnalytics();
      const plugin = new SegmentUsagePlugin(() => analytics);

      plugin.send(
        makeCollectionEvent([
          { key: "FLAG_A", rawValue: "on" },
          { key: "FLAG_B", rawValue: "off" },
        ]),
      );

      const call = (analytics.track as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as any;
      expect(call.properties).toMatchObject({ FLAG_A: "on", FLAG_B: "off" });
    });
  });

  describe("send — unrecognised event (no eventName)", () => {
    it("does not call analytics.track for a base UsageEvent", () => {
      const analytics = makeMockAnalytics();
      const plugin = new SegmentUsagePlugin(() => analytics);

      plugin.send(new BaseUsageEvent("user-123"));

      expect(analytics.track).not.toHaveBeenCalled();
    });
  });

  describe("analytics factory", () => {
    it("calls the factory function on each send to pick up the current analytics instance", () => {
      const factory = vi.fn(() => makeMockAnalytics());
      const plugin = new SegmentUsagePlugin(factory);

      plugin.send(makeFeatureEvent("F", "v"));
      plugin.send(makeFeatureEvent("G", "w"));

      expect(factory).toHaveBeenCalledTimes(2);
    });
  });
});

describe("FeatureHubSegmentEnrichmentPlugin", () => {
  describe("track", () => {
    it("enriches the context with FeatureHub usage when contextSource is set", () => {
      const updateEvent = vi.fn();
      const mockCtx = makeMockContext(updateEvent);

      const usageRecord = { country: "nz", plan: "pro" };
      const fhCtx = {
        getContextUsage: () => ({ collectUsageRecord: () => usageRecord }),
      } as any;

      const plugin = new FeatureHubSegmentEnrichmentPlugin().contextSource(() => fhCtx);
      plugin.track(mockCtx);

      expect(updateEvent).toHaveBeenCalledOnce();
      expect(updateEvent).toHaveBeenCalledWith("context", usageRecord);
    });

    it("returns the context unchanged when no contextSource is set", () => {
      const updateEvent = vi.fn();
      const mockCtx = makeMockContext(updateEvent);

      const plugin = new FeatureHubSegmentEnrichmentPlugin();
      const result = plugin.track(mockCtx);

      expect(updateEvent).not.toHaveBeenCalled();
      expect(result).toBe(mockCtx);
    });

    it("returns the context after enrichment", () => {
      const mockCtx = makeMockContext();
      const fhCtx = {
        getContextUsage: () => ({ collectUsageRecord: () => ({}) }),
      } as any;

      const plugin = new FeatureHubSegmentEnrichmentPlugin().contextSource(() => fhCtx);
      const result = plugin.track(mockCtx);

      expect(result).toBe(mockCtx);
    });

    it("contextSource can be changed to return a different context per call", () => {
      const updateEvent = vi.fn();
      const mockCtx = makeMockContext(updateEvent);

      const record1 = { plan: "basic" };
      const record2 = { plan: "pro" };
      let toggle = true;

      const plugin = new FeatureHubSegmentEnrichmentPlugin().contextSource(() => {
        const rec = toggle ? record1 : record2;
        toggle = !toggle;
        return { getContextUsage: () => ({ collectUsageRecord: () => rec }) } as any;
      });

      plugin.track(mockCtx);
      plugin.track(mockCtx);

      expect(updateEvent.mock.calls[0]?.[1]).toEqual(record1);
      expect(updateEvent.mock.calls[1]?.[1]).toEqual(record2);
    });
  });

  describe("plugin metadata", () => {
    it("has the correct name, version, and type", () => {
      const plugin = new FeatureHubSegmentEnrichmentPlugin();
      expect(plugin.name).toBe("featurehub-segment-enrichment-plugin");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.type).toBe("enrichment");
    });

    it("isLoaded returns true", () => {
      expect(new FeatureHubSegmentEnrichmentPlugin().isLoaded()).toBe(true);
    });

    it("ready resolves", async () => {
      await expect(new FeatureHubSegmentEnrichmentPlugin().ready()).resolves.toBeUndefined();
    });

    it("load resolves", async () => {
      const plugin = new FeatureHubSegmentEnrichmentPlugin();
      await expect(plugin.load(makeMockContext(), {} as CoreAnalytics)).resolves.toBeUndefined();
    });
  });

  describe("pass-through methods", () => {
    it.each(["alias", "group", "identify", "page", "screen"] as const)(
      "%s returns the context unchanged",
      (method) => {
        const mockCtx = makeMockContext();
        const plugin = new FeatureHubSegmentEnrichmentPlugin();
        expect(plugin[method](mockCtx)).toBe(mockCtx);
      },
    );

    it("unload returns the context", () => {
      const mockCtx = makeMockContext();
      const plugin = new FeatureHubSegmentEnrichmentPlugin();
      expect(plugin.unload(mockCtx, {} as CoreAnalytics)).toBe(mockCtx);
    });
  });
});
