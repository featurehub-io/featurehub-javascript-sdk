import type { ClientContext } from "./client_context";
import { fhLog } from "./feature_hub_config";
import type { FeatureListener, FeatureListenerHandle, FeatureStateHolder } from "./feature_state";
import type { InternalFeatureRepository } from "./internal_feature_repository";
import { ListenerUtils } from "./listener_utils";
import { type FeatureState, FeatureValueType } from "./models";

interface ListenerTracker {
  listener: FeatureListener;
  holder: FeatureStateHolder;
}

interface ListenerOriginal {
  value: any;
}

export class FeatureStateBaseHolder<T = any> implements FeatureStateHolder<T> {
  protected internalFeatureState: FeatureState | undefined;
  protected _key: string;
  protected listeners: Map<number, ListenerTracker> = new Map<number, ListenerTracker>();
  protected _repo: InternalFeatureRepository;
  protected _ctx: ClientContext | undefined;

  protected parentHolder: FeatureStateBaseHolder | undefined;

  constructor(
    repository: InternalFeatureRepository,
    key: string,
    existingHolder?: FeatureStateBaseHolder,
  ) {
    if (existingHolder !== null && existingHolder !== undefined) {
      this.listeners = existingHolder.listeners;
    }

    this._repo = repository;
    this._key = key;
  }

  get key(): string {
    return this.getKey();
  }

  get str(): string | undefined {
    return this.getString();
  }

  get flag(): boolean | undefined {
    return this.getFlag();
  }

  get num(): number | undefined {
    return this.getNumber();
  }

  get rawJson(): string | undefined {
    return this.getRawJson();
  }

  // this is a real feature or a placeholder one
  get exists(): boolean {
    return this.internalFeatureState !== undefined;
  }

  get locked(): boolean {
    return this.isLocked();
  }

  get enabled(): boolean {
    return this.isEnabled();
  }

  get version(): number {
    return this.getVersion();
  }

  get type(): FeatureValueType | undefined {
    return this.getType();
  }

  public withContext(param: ClientContext): FeatureStateHolder {
    const fsh = this._copy();
    fsh._ctx = param;
    return fsh;
  }

  public isEnabled(): boolean {
    return this.getBoolean() === true;
  }

  public addListener(listener: FeatureListener<T>): FeatureListenerHandle {
    const pos = ListenerUtils.newListenerKey(this.listeners);

    if (this._ctx !== undefined) {
      this.listeners.set(pos, {
        listener: () => listener(this),
        holder: this,
      });
    } else {
      this.listeners.set(pos, {
        listener: listener,
        holder: this,
      });
    }

    return pos;
  }

  public removeListener(handle: FeatureListener<T> | FeatureListenerHandle) {
    ListenerUtils.removeListener(this.listeners, handle);
  }

  public getBoolean(): boolean | undefined {
    return this._getValue(FeatureValueType.Boolean) as boolean | undefined;
  }

  public getFlag(): boolean | undefined {
    return this.getBoolean();
  }

  public getKey(): string {
    return this._key;
  }

  getNumber(): number | undefined {
    return this._getValue(FeatureValueType.Number) as number | undefined;
  }

  getRawJson(): string | undefined {
    return this._getValue(FeatureValueType.Json) as string | undefined;
  }

  getString(): string | undefined {
    return this._getValue(FeatureValueType.String) as string | undefined;
  }

  isSet(): boolean {
    const val = this._getValue();
    return val !== undefined && val != null;
  }

  getFeatureState(): FeatureState | undefined {
    return this.featureState();
  }

  /// returns true if the value changed, _only_ the repository should call this
  /// as it is dereferenced via the parentHolder
  setFeatureState(fs: FeatureState | undefined): boolean {
    const existingValue = this._getValue(fs?.type, false, false);
    const existingLocked = this.locked;

    // capture all the original values of the listeners
    const listenerValues: Map<number, ListenerOriginal> = new Map<number, ListenerOriginal>();
    this.listeners.forEach((value, key) => {
      listenerValues.set(key, {
        value: value.holder.value,
      });
    });

    this.internalFeatureState = fs;

    // the lock changing is not part of the contextual evaluation of values changing, and is constant across all listeners.
    const changedLocked = existingLocked !== this.featureState()?.l;
    // did at least the default value change, even if there are no listeners for the state?
    let changed = changedLocked || existingValue !== this._getValue(fs?.type, false, false);

    this.listeners.forEach((value, key) => {
      const original = listenerValues.get(key);
      if (changedLocked || original?.value !== value.holder.value) {
        changed = true;

        try {
          value.listener(value.holder);
        } catch (e) {
          fhLog.error("Failed to trigger listener", e);
        }
      }
    });

    return changed;
  }

  copy(): FeatureStateHolder {
    return this._copy();
  }

  get id(): string | undefined {
    return this.featureState()?.id;
  }

  getType(): FeatureValueType | undefined {
    return this.featureState()?.type;
  }

  getVersion(): number {
    const version1 = this.featureState()?.version;
    return version1 !== undefined ? version1 : -1;
  }

  isLocked(): boolean {
    return this.featureState() === undefined ? false : this.featureState()!.l!;
  }

  triggerListeners(feature: FeatureStateHolder): void {
    this.listeners.forEach((l) => {
      try {
        l.listener(feature || this);
      } catch (_) {
        //
      } // don't care
    });
  }

  private _copy(): FeatureStateBaseHolder {
    const bh = new FeatureStateBaseHolder(this._repo, this._key, this);
    bh.parentHolder = this;
    return bh;
  }

  get environmentId(): string | undefined {
    const envId = this.featureState()?.environmentId;
    // use == instead of === as we want undefined and null to be equal here
    return envId == null ? undefined : envId;
  }

  private featureState(): FeatureState | undefined {
    if (this.internalFeatureState !== undefined) {
      return this.internalFeatureState;
    }

    if (this.parentHolder !== undefined) {
      return this.parentHolder.featureState();
    }

    return this.internalFeatureState;
  }

  private _getValue(
    type?: FeatureValueType,
    parseJson = false,
    triggerUsage = true,
  ): any | undefined {
    if (!type) {
      type = this.getType();
    }
    if (!type) {
      return undefined;
    }

    const featureState = this.featureState();
    if (!this.isLocked()) {
      const [intercepted, interceptValue] = this._repo.valueInterceptorMatched(
        this._key,
        featureState,
      );

      if (intercepted) {
        const val = this._castType(type, interceptValue, parseJson);

        // we only trigger usage for featureState's that exist.
        return triggerUsage && featureState?.id ? this.used(featureState, val) : val;
      }
    }

    if (!featureState || featureState.type !== type) {
      return undefined;
    }

    if (this._ctx != null && featureState.strategies?.length) {
      const matched = this._repo.apply(
        featureState!.strategies || [],
        this._key,
        featureState.id,
        this._ctx,
      );

      if (matched.matched) {
        const sVal = this._castType(type, matched.value, parseJson);
        return triggerUsage ? this.used(featureState, sVal) : sVal;
      }
    }

    return triggerUsage ? this.used(featureState, featureState.value) : featureState.value;
  }

  private used(fs: FeatureState, value: any | undefined): any | undefined {
    if (this._ctx) {
      this._ctx.used(fs.key, fs.id, value, fs.type!, fs.environmentId!);
    } else {
      const usageProvider = this._repo.usageProvider;
      if (usageProvider) {
        // in testing with substitutions this can be undefined
        this._repo.recordUsageEvent(
          usageProvider.createUsageFeature(
            usageProvider.createFeatureHubUsageValueFromFields(
              fs.id,
              fs.key,
              value,
              fs.type!,
              fs.environmentId!,
            ),
          ),
        );
      }
    }

    return value;
  }

  private _castType(type: FeatureValueType, value?: any, parseJson = false): any | undefined {
    if (value == null) {
      return undefined;
    }

    if (type === FeatureValueType.Boolean) {
      return typeof value === "boolean" ? value : "true" === value.toString();
    } else if (type === FeatureValueType.String) {
      return value.toString();
    } else if (type === FeatureValueType.Number) {
      if (typeof value === "number") {
        return value;
      }
      if (value.includes(".")) {
        return parseFloat(value);
      }

      return parseInt(value);
    } else if (type === FeatureValueType.Json) {
      if (parseJson) {
        try {
          return JSON.parse(value.toString());
        } catch {
          return {}; // default return empty obj
        }
      }

      return value.toString();
    } else {
      return value.toString();
    }
  }

  get value(): T {
    return this._getValue(this.getType(), true);
  }

  get untrackedValue(): T {
    return this._getValue(this.getType(), true, false);
  }

  get featureProperties(): Record<string, string> | undefined {
    return this.featureState()?.fp ?? undefined;
  }
}
