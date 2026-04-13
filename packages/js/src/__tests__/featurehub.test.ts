import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ClientContext, type FeatureHubConfig } from "../index";
import { FeatureHub } from "../index";

describe("FeatureHub static helpers", () => {
  let dom: any;

  beforeEach(async () => {
    const { JSDOM } = await import("jsdom");
    dom = new JSDOM("", { url: "https://localhost" });

    Object.defineProperty(globalThis, "window", {
      value: dom.window,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Clear window state between tests
    delete (dom.window as any).fhConfig;
    delete (dom.window as any).fhContext;
    dom.window.close();
  });

  describe("isCompletelyConfigured", () => {
    it("returns false when neither config nor context is set", () => {
      expect(FeatureHub.isCompletelyConfigured()).toBe(false);
    });

    it("returns false when only config is set", () => {
      FeatureHub.setConfig({ close: () => {} } as unknown as FeatureHubConfig);
      expect(FeatureHub.isCompletelyConfigured()).toBe(false);
    });

    it("returns false when only context is set", () => {
      FeatureHub.setContext({} as unknown as ClientContext);
      expect(FeatureHub.isCompletelyConfigured()).toBe(false);
    });

    it("returns true when both config and context are set", () => {
      FeatureHub.set(
        { close: () => {} } as unknown as FeatureHubConfig,
        {} as unknown as ClientContext,
      );
      expect(FeatureHub.isCompletelyConfigured()).toBe(true);
    });
  });

  describe("isConfigSet", () => {
    it("returns false when config is not set", () => {
      expect(FeatureHub.isConfigSet()).toBe(false);
    });

    it("returns true when config is set", () => {
      FeatureHub.setConfig({ close: () => {} } as unknown as FeatureHubConfig);
      expect(FeatureHub.isConfigSet()).toBe(true);
    });

    it("returns true even when context is not set", () => {
      FeatureHub.setConfig({ close: () => {} } as unknown as FeatureHubConfig);
      expect(FeatureHub.isConfigSet()).toBe(true);
      expect(FeatureHub.isContextSet()).toBe(false);
    });
  });

  describe("isContextSet", () => {
    it("returns false when context is not set", () => {
      expect(FeatureHub.isContextSet()).toBe(false);
    });

    it("returns true when context is set", () => {
      FeatureHub.setContext({} as unknown as ClientContext);
      expect(FeatureHub.isContextSet()).toBe(true);
    });

    it("returns true even when config is not set", () => {
      FeatureHub.setContext({} as unknown as ClientContext);
      expect(FeatureHub.isContextSet()).toBe(true);
      expect(FeatureHub.isConfigSet()).toBe(false);
    });
  });
});
