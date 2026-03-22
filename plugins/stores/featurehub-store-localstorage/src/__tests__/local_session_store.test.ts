import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ClientFeatureRepository,
  type FeatureHubConfig,
  type FeatureState,
  FeatureValueType,
  SSEResultState,
} from "featurehub-javascript-core-sdk";

import { LocalSessionStore } from "../local_session_store";

// Minimal in-memory Storage implementation for testing
class FakeStorage implements Storage {
  private _data: Record<string, string> = {};

  get length(): number {
    return Object.keys(this._data).length;
  }

  key(index: number): string | null {
    return Object.keys(this._data)[index] ?? null;
  }

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key]! : null;
  }

  setItem(key: string, value: string): void {
    this._data[key] = value;
  }

  removeItem(key: string): void {
    delete this._data[key];
  }

  clear(): void {
    this._data = {};
  }
}

const FEATURE_URL = "https://edge.featurehub.io/features?apiKey=abc123";

function makeConfig(repo: ClientFeatureRepository, featureUrl = FEATURE_URL): FeatureHubConfig {
  return {
    featureUrl: () => featureUrl,
    repository: () => repo,
  } as unknown as FeatureHubConfig;
}

function makeFeature(overrides: Partial<FeatureState> = {}): FeatureState {
  return {
    id: "f1",
    key: "banana",
    version: 1,
    type: FeatureValueType.Boolean,
    value: true,
    ...overrides,
  } as FeatureState;
}

describe("LocalSessionStore", () => {
  let repo: ClientFeatureRepository;
  let storage: FakeStorage;

  beforeEach(() => {
    repo = new ClientFeatureRepository();
    storage = new FakeStorage();
  });

  describe("initialisation", () => {
    it("registers itself as a RawUpdateFeatureListener on construction", () => {
      const registerSpy = vi.spyOn(repo, "registerRawUpdateFeatureListener");
      const config = makeConfig(repo);
      new LocalSessionStore(config, storage);
      expect(registerSpy).toHaveBeenCalledOnce();
    });

    it("does nothing when session storage is empty", () => {
      const notifySpy = vi.spyOn(repo, "notify");
      const config = makeConfig(repo);
      new LocalSessionStore(config, storage);
      expect(notifySpy).not.toHaveBeenCalled();
    });

    it("replays stored features into the repository on startup", () => {
      const feature = makeFeature();
      const stored: Record<string, FeatureState> = { [feature.id]: feature };
      storage.setItem(FEATURE_URL, JSON.stringify(stored));

      const notifySpy = vi.spyOn(repo, "notify");
      const config = makeConfig(repo);
      new LocalSessionStore(config, storage);

      expect(notifySpy).toHaveBeenCalledOnce();
      expect(notifySpy).toHaveBeenCalledWith(
        SSEResultState.Features,
        [feature],
        "local-session-store",
      );
    });

    it("ignores malformed JSON in session storage", () => {
      storage.setItem(FEATURE_URL, "not-valid-json{{{");
      const notifySpy = vi.spyOn(repo, "notify");
      const config = makeConfig(repo);
      expect(() => new LocalSessionStore(config, storage)).not.toThrow();
      expect(notifySpy).not.toHaveBeenCalled();
    });
  });

  describe("processUpdates", () => {
    it("persists a full feature list to session storage", () => {
      const config = makeConfig(repo);
      const store = new LocalSessionStore(config, storage);
      const f1 = makeFeature({ id: "f1", key: "banana" });
      const f2 = makeFeature({ id: "f2", key: "apple", value: false });

      store.processUpdates([f1, f2], "polling-service");

      const saved = JSON.parse(storage.getItem(FEATURE_URL)!) as Record<string, FeatureState>;
      expect(saved["f1"]).toMatchObject({ id: "f1", key: "banana" });
      expect(saved["f2"]).toMatchObject({ id: "f2", key: "apple" });
    });

    it("replaces the entire store on each call", () => {
      const config = makeConfig(repo);
      const store = new LocalSessionStore(config, storage);
      store.processUpdates([makeFeature({ id: "f1", key: "banana" })], "polling-service");
      store.processUpdates([makeFeature({ id: "f2", key: "apple" })], "polling-service");

      const saved = JSON.parse(storage.getItem(FEATURE_URL)!) as Record<string, FeatureState>;
      expect(Object.keys(saved)).toEqual(["f2"]);
    });

    it("drops updates from local-session-store source", () => {
      const config = makeConfig(repo);
      const store = new LocalSessionStore(config, storage);
      store.processUpdates([makeFeature()], "local-session-store");
      expect(storage.getItem(FEATURE_URL)).toBeNull();
    });
  });

  describe("processUpdate", () => {
    it("upserts a single feature in session storage", () => {
      const config = makeConfig(repo);
      const store = new LocalSessionStore(config, storage);
      const f1 = makeFeature({ id: "f1", key: "banana", value: true });
      const f2 = makeFeature({ id: "f2", key: "apple", value: false });

      store.processUpdate(f1, "streaming-service");
      store.processUpdate(f2, "streaming-service");

      const saved = JSON.parse(storage.getItem(FEATURE_URL)!) as Record<string, FeatureState>;
      expect(saved["f1"]).toMatchObject({ key: "banana" });
      expect(saved["f2"]).toMatchObject({ key: "apple" });
    });

    it("overwrites an existing feature with the same id", () => {
      const config = makeConfig(repo);
      const store = new LocalSessionStore(config, storage);
      store.processUpdate(makeFeature({ id: "f1", value: true }), "streaming-service");
      store.processUpdate(makeFeature({ id: "f1", value: false }), "streaming-service");

      const saved = JSON.parse(storage.getItem(FEATURE_URL)!) as Record<string, FeatureState>;
      expect(saved["f1"]!.value).toBe(false);
    });

    it("drops updates from local-session-store source", () => {
      const config = makeConfig(repo);
      const store = new LocalSessionStore(config, storage);
      store.processUpdate(makeFeature(), "local-session-store");
      expect(storage.getItem(FEATURE_URL)).toBeNull();
    });
  });

  describe("delete", () => {
    it("removes a feature from session storage", () => {
      const config = makeConfig(repo);
      const store = new LocalSessionStore(config, storage);
      store.processUpdate(makeFeature({ id: "f1" }), "polling-service");
      store.deleteFeature(makeFeature({ id: "f1" }), "polling-service");

      const saved = JSON.parse(storage.getItem(FEATURE_URL)!) as Record<string, FeatureState>;
      expect(saved["f1"]).toBeUndefined();
    });

    it("is a no-op when deleting a feature that does not exist", () => {
      const config = makeConfig(repo);
      const store = new LocalSessionStore(config, storage);
      expect(() =>
        store.deleteFeature(makeFeature({ id: "unknown" }), "polling-service"),
      ).not.toThrow();
    });

    it("drops deletes from local-session-store source", () => {
      const config = makeConfig(repo);
      const store = new LocalSessionStore(config, storage);
      store.processUpdate(makeFeature({ id: "f1" }), "polling-service");

      // capture state before the no-op delete
      const before = storage.getItem(FEATURE_URL);
      store.deleteFeature(makeFeature({ id: "f1" }), "local-session-store");
      expect(storage.getItem(FEATURE_URL)).toBe(before);
    });
  });

  describe("configChanged", () => {
    it("does nothing when featureUrl has not changed", () => {
      const config = makeConfig(repo);
      const store = new LocalSessionStore(config, storage);
      store.processUpdate(makeFeature({ id: "f1" }), "polling-service");
      const before = storage.getItem(FEATURE_URL);

      store.configChanged();
      expect(storage.getItem(FEATURE_URL)).toBe(before);
    });

    it("switches to new key and replays stored data when featureUrl changes", () => {
      const newUrl = "https://edge.featurehub.io/features?apiKey=xyz";
      const feature = makeFeature();
      const stored: Record<string, FeatureState> = { [feature.id]: feature };
      storage.setItem(newUrl, JSON.stringify(stored));

      let currentUrl = FEATURE_URL;
      const config = {
        featureUrl: () => currentUrl,
        repository: () => repo,
      } as unknown as FeatureHubConfig;

      const store = new LocalSessionStore(config, storage);
      const notifySpy = vi.spyOn(repo, "notify");

      currentUrl = newUrl;
      store.configChanged();

      expect(notifySpy).toHaveBeenCalledWith(
        SSEResultState.Features,
        [feature],
        "local-session-store",
      );
    });

    it("clears in-memory store when switching to a key with no stored data", () => {
      let currentUrl = FEATURE_URL;
      const config = {
        featureUrl: () => currentUrl,
        repository: () => repo,
      } as unknown as FeatureHubConfig;

      const store = new LocalSessionStore(config, storage);
      store.processUpdate(makeFeature({ id: "f1" }), "polling-service");

      currentUrl = "https://edge.featurehub.io/features?apiKey=new";
      store.configChanged();

      // new url has no data — persisting under new key should show empty store
      store.processUpdate(makeFeature({ id: "f2" }), "polling-service");
      const saved = JSON.parse(storage.getItem(currentUrl)!) as Record<string, FeatureState>;
      expect(Object.keys(saved)).toEqual(["f2"]);
    });
  });

  describe("close", () => {
    it("deregisters itself from the repository", () => {
      const removeSpy = vi.spyOn(repo, "removeRawUpdateFeatureListener");
      const config = makeConfig(repo);
      const store = new LocalSessionStore(config, storage);
      store.close();
      expect(removeSpy).toHaveBeenCalledOnce();
    });
  });
});
