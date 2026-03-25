import {
  type FeatureHubConfig,
  type FeatureState,
  type InternalFeatureRepository,
  type RawUpdateFeatureListener,
  SSEResultState,
} from "featurehub-javascript-core-sdk";

const LOCAL_SESSION_SOURCE = "local-session-store";

export class LocalSessionStore implements RawUpdateFeatureListener {
  private readonly _config: FeatureHubConfig;
  private readonly _storage: Storage;
  private _storageKey: string;
  private _store: Record<string, FeatureState> = {};
  private _listenerHandle: number;

  constructor(config: FeatureHubConfig, storage?: Storage) {
    this._config = config;
    this._storage = storage ?? sessionStorage;
    this._storageKey = config.featureUrl();
    this._listenerHandle = config.repository().registerRawUpdateFeatureListener(this);
    this._init(this._storageKey);
  }

  private _init(key: string): void {
    const raw = this._storage.getItem(key);
    if (raw) {
      try {
        const stored = JSON.parse(raw) as Record<string, FeatureState>;
        this._store = stored;
        (this._config.repository() as InternalFeatureRepository).notify(
          SSEResultState.Features,
          Object.values(stored),
          LOCAL_SESSION_SOURCE,
        );
      } catch {
        // ignore malformed data
      }
    }
  }

  private _persist(): void {
    this._storage.setItem(this._storageKey, JSON.stringify(this._store));
  }

  get connected(): boolean {
    return true;
  }

  deleteFeature(feature: FeatureState, source: string): void {
    if (source === LOCAL_SESSION_SOURCE) return;
    delete this._store[feature.id];
    this._persist();
  }

  processUpdates(features: Array<FeatureState>, source: string): void {
    if (source === LOCAL_SESSION_SOURCE) return;
    this._store = Object.fromEntries(features.map((f) => [f.id, f]));
    this._persist();
  }

  processUpdate(feature: FeatureState, source: string): void {
    if (source === LOCAL_SESSION_SOURCE) return;
    this._store[feature.id] = feature;
    this._persist();
  }

  configChanged(): void {
    const newKey = this._config.featureUrl();
    if (newKey !== this._storageKey) {
      this._storageKey = newKey;
      this._store = {};
      this._init(newKey);
    }
  }

  close(): void {
    this._config.repository().removeRawUpdateFeatureListener(this._listenerHandle);
  }
}
