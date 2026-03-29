import {
  BaseUsageEvent,
  BaseUsageEventWithFeature,
  BaseUsageFeaturesCollection,
  FeatureHubUsageValue,
  FeatureValueType,
  FHLog,
} from "featurehub-javascript-core-sdk";
import { describe, expect, it, vi } from "vitest";

import { OpenTelemetryBaggagePlugin } from "../baggage_plugin";

// Testable subclass: injects a fake existing fhub baggage and captures what was set
class TestableBaggagePlugin extends OpenTelemetryBaggagePlugin {
  private _existingFhub: string | undefined;
  public lastSetValue: string | undefined = undefined;
  public setBaggageCallCount = 0;

  constructor(existingFhub?: string) {
    super();
    this._existingFhub = existingFhub;
  }

  protected override getBaggageEntry(): string | undefined {
    return this._existingFhub;
  }

  protected override setBaggageEntry(value: string): void {
    this.lastSetValue = value;
    this.setBaggageCallCount++;
  }
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
  type?: FeatureValueType,
): BaseUsageEventWithFeature {
  return new BaseUsageEventWithFeature(makeUsageValue(key, rawValue, type));
}

function makeCollectionEvent(
  features: Array<{
    key: string;
    rawValue: boolean | string | number | undefined;
    type?: FeatureValueType;
  }>,
): BaseUsageFeaturesCollection {
  const event = new BaseUsageFeaturesCollection();
  event.featureValues = features.map(({ key, rawValue, type }) =>
    makeUsageValue(key, rawValue, type),
  );
  return event;
}

describe("OpenTelemetryBaggagePlugin", () => {
  describe("UsageEventWithFeature", () => {
    it("sets a string feature in an empty baggage", () => {
      const plugin = new TestableBaggagePlugin();
      plugin.send(makeFeatureEvent("MY_KEY", "hello world", FeatureValueType.String));
      expect(plugin.lastSetValue).toBe("MY_KEY=hello%20world");
    });

    it("sets a boolean feature", () => {
      const plugin = new TestableBaggagePlugin();
      plugin.send(makeFeatureEvent("MY_FLAG", true, FeatureValueType.Boolean));
      expect(plugin.lastSetValue).toBe("MY_FLAG=true");
    });

    it("sets a number feature", () => {
      const plugin = new TestableBaggagePlugin();
      plugin.send(makeFeatureEvent("PRICE", 3.14, FeatureValueType.Number));
      expect(plugin.lastSetValue).toBe("PRICE=3.14");
    });

    it("encodes a JSON feature value", () => {
      const json = '{"a":1}';
      const plugin = new TestableBaggagePlugin();
      plugin.send(makeFeatureEvent("CONFIG", json, FeatureValueType.Json));
      expect(plugin.lastSetValue).toBe(`CONFIG=${encodeURIComponent(json)}`);
    });

    it("writes a key-only entry when rawValue is undefined", () => {
      const plugin = new TestableBaggagePlugin();
      plugin.send(makeFeatureEvent("MY_KEY", undefined));
      expect(plugin.lastSetValue).toBe("MY_KEY");
    });

    it("merges with existing baggage entries", () => {
      const plugin = new TestableBaggagePlugin("ALPHA=1,GAMMA=3");
      plugin.send(makeFeatureEvent("BETA", "two", FeatureValueType.String));
      expect(plugin.lastSetValue).toBe("ALPHA=1,BETA=two,GAMMA=3");
    });

    it("accepts a write when the existing value is the same (idempotent)", () => {
      const plugin = new TestableBaggagePlugin("MY_FLAG=true");
      plugin.send(makeFeatureEvent("MY_FLAG", true, FeatureValueType.Boolean));
      expect(plugin.lastSetValue).toBe("MY_FLAG=true");
    });

    it("rejects a write and logs a warning when the new value differs from the existing one", () => {
      const errorSpy = vi.spyOn(FHLog.fhLog, "warn").mockImplementation(() => {});
      try {
        const plugin = new TestableBaggagePlugin("MY_FLAG=false");
        plugin.send(makeFeatureEvent("MY_FLAG", true, FeatureValueType.Boolean));
        expect(plugin.lastSetValue).toBeUndefined();
        expect(errorSpy).toHaveBeenCalledOnce();
        expect(errorSpy.mock.calls[0]?.[0]).toMatch(/MY_FLAG/);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("produces keys in alphabetical order", () => {
      const plugin = new TestableBaggagePlugin("ZETA=z");
      plugin.send(makeFeatureEvent("ALPHA", "a", FeatureValueType.String));
      expect(plugin.lastSetValue).toBe("ALPHA=a,ZETA=z");
    });
  });

  describe("UsageFeaturesCollection", () => {
    it("sets multiple features sorted alphabetically", () => {
      const plugin = new TestableBaggagePlugin();
      plugin.send(
        makeCollectionEvent([
          { key: "ZETA", rawValue: "z" },
          { key: "ALPHA", rawValue: "a" },
          { key: "BETA", rawValue: "b" },
        ]),
      );
      expect(plugin.lastSetValue).toBe("ALPHA=a,BETA=b,ZETA=z");
    });

    it("merges collection features with existing baggage", () => {
      const plugin = new TestableBaggagePlugin("EXISTING=old");
      plugin.send(
        makeCollectionEvent([{ key: "NEW_FLAG", rawValue: true, type: FeatureValueType.Boolean }]),
      );
      expect(plugin.lastSetValue).toBe("EXISTING=old,NEW_FLAG=true");
    });

    it("accepts a collection write when the existing value is the same (idempotent)", () => {
      const plugin = new TestableBaggagePlugin("MY_NUM=99");
      plugin.send(
        makeCollectionEvent([{ key: "MY_NUM", rawValue: 99, type: FeatureValueType.Number }]),
      );
      expect(plugin.lastSetValue).toBe("MY_NUM=99");
    });

    it("rejects a conflicting key in a collection and logs a warning, leaving the original value", () => {
      const errorSpy = vi.spyOn(FHLog.fhLog, "warn").mockImplementation(() => {});
      try {
        const plugin = new TestableBaggagePlugin("MY_NUM=1,OTHER=x");
        plugin.send(
          makeCollectionEvent([
            { key: "MY_NUM", rawValue: 99, type: FeatureValueType.Number },
            { key: "NEW", rawValue: "n" },
          ]),
        );
        expect(plugin.lastSetValue).toBe("MY_NUM=1,NEW=n,OTHER=x");
        expect(errorSpy).toHaveBeenCalledOnce();
        expect(errorSpy.mock.calls[0]?.[0]).toMatch(/MY_NUM/);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("handles undefined rawValues in a collection", () => {
      const plugin = new TestableBaggagePlugin();
      plugin.send(
        makeCollectionEvent([
          { key: "A", rawValue: undefined },
          { key: "B", rawValue: "val" },
        ]),
      );
      expect(plugin.lastSetValue).toBe("A,B=val");
    });

    it("does not call setBaggageEntry for an empty collection", () => {
      const plugin = new TestableBaggagePlugin();
      plugin.send(makeCollectionEvent([]));
      expect(plugin.setBaggageCallCount).toBe(0);
    });
  });

  describe("unrecognised event types", () => {
    it("does not call setBaggageEntry for an unknown event type", () => {
      const plugin = new TestableBaggagePlugin();
      plugin.send(new BaseUsageEvent());
      expect(plugin.setBaggageCallCount).toBe(0);
    });
  });

  // Tests for ALS-based accumulation. These use a subclass that overrides only
  // updateOtelContext (skipping the OTel internal API call in tests) while
  // letting the real setBaggageEntry / _featureStore ALS run, so that we can
  // verify that successive single-feature send() calls within the same async
  // chain accumulate correctly.
  describe("AsyncLocalStorage accumulation", () => {
    class AccumulatingPlugin extends OpenTelemetryBaggagePlugin {
      public readonly updates: string[] = [];

      protected override updateOtelContext(value: string): void {
        this.updates.push(value);
      }
    }

    it("accumulates successive single-feature events in alphabetical order", async () => {
      const plugin = new AccumulatingPlugin();
      plugin.send(makeFeatureEvent("Z_FLAG", true, FeatureValueType.Boolean));
      plugin.send(makeFeatureEvent("A_KEY", "hello", FeatureValueType.String));
      plugin.send(makeFeatureEvent("M_NUM", 42, FeatureValueType.Number));

      expect(plugin.updates).toHaveLength(3);
      expect(plugin.updates[0]).toBe("Z_FLAG=true");
      expect(plugin.updates[1]).toBe("A_KEY=hello,Z_FLAG=true");
      expect(plugin.updates[2]).toBe("A_KEY=hello,M_NUM=42,Z_FLAG=true");
    });

    it("initialises the store from incoming OTel baggage on a downstream service", async () => {
      // Simulate a downstream service where the fhub baggage arrived via OTel
      // context propagation — i.e. getBaggageEntry falls back to the OTel path.
      class DownstreamPlugin extends AccumulatingPlugin {
        protected override getBaggageEntry(): string | undefined {
          // Our own ALS store is empty on this fresh chain; fall back as the
          // real implementation does.
          const store = (this as any)._featureStore?.getStore?.();
          if (store?.size) return undefined; // unused in this test
          // Simulate incoming fhub from upstream
          return "UPSTREAM_A=old,UPSTREAM_B=val";
        }
      }

      const plugin = new DownstreamPlugin();
      // Evaluating an additional feature should merge with the incoming baggage.
      plugin.send(makeFeatureEvent("NEW_KEY", "new", FeatureValueType.String));

      expect(plugin.updates).toHaveLength(1);
      expect(plugin.updates[0]).toBe("NEW_KEY=new,UPSTREAM_A=old,UPSTREAM_B=val");
    });

    it("rejects a conflicting value from a new send against an accumulated entry", async () => {
      const warnSpy = vi.spyOn(FHLog.fhLog, "warn").mockImplementation(() => {});
      try {
        const plugin = new AccumulatingPlugin();
        plugin.send(makeFeatureEvent("FLAG", true, FeatureValueType.Boolean));
        // Second send tries to write a different value for FLAG
        plugin.send(makeFeatureEvent("FLAG", false, FeatureValueType.Boolean));

        expect(plugin.updates).toHaveLength(1);
        console.log(plugin.updates);
        // First send wrote true; second send is rejected — output stays true
        expect(plugin.updates[0]).toBe("FLAG=true");
        expect(warnSpy).toHaveBeenCalledOnce();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
