import type { ClientContext } from "./client_context";
import { EvaluatedFeature } from "./evaluated_feature";
import { fhLog } from "./feature_hub_config";
import type {
  FeatureListener,
  FeatureListenerHandle,
  FeatureStateHolder,
  FeatureValue,
} from "./feature_state";
import type { InternalFeatureRepository } from "./internal_feature_repository";
import { ListenerUtils } from "./listener_utils";
import { type FeatureState, FeatureValueType } from "./models";

interface ListenerTracker {
  listener: FeatureListener;
  holder: FeatureStateHolder;
}

interface ListenerOriginal {
  value: unknown;
}

export class FeatureStateBaseHolder implements FeatureStateHolder {
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
    return this.featureState() !== undefined;
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

  public addListener(listener: FeatureListener): FeatureListenerHandle {
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

  public removeListener(handle: FeatureListener | FeatureListenerHandle) {
    ListenerUtils.removeListener(this.listeners, handle);
  }

  public getBoolean(): boolean | undefined {
    return this._castType(FeatureValueType.Boolean, this.internalGetValue()) as boolean | undefined;
  }

  public getFlag(): boolean | undefined {
    return this.getBoolean();
  }

  public getKey(): string {
    return this._key;
  }

  getNumber(): number | undefined {
    return this._castType(FeatureValueType.Number, this.internalGetValue()) as number | undefined;
  }

  getRawJson(): string | undefined {
    return this._castType(FeatureValueType.Json, this.internalGetValue()) as string | undefined;
  }

  getString(): string | undefined {
    return this._castType(FeatureValueType.String, this.internalGetValue()) as string | undefined;
  }

  isSet(): boolean {
    const val = this.internalGetValue();
    return val !== undefined && val != null;
  }

  getFeatureState(): FeatureState | undefined {
    return this.featureState();
  }

  /// returns true if the value changed, _only_ the repository should call this
  /// as it is dereferenced via the parentHolder
  setFeatureState(fs: FeatureState | undefined): boolean {
    const existingValue = this.internalGetValue(false);
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
    let changed = changedLocked || existingValue?.value !== this.internalGetValue(false)?.value;

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

  public internalGetValue(triggerUsage = true): EvaluatedFeature | undefined {
    const fs = this.featureState();
    const [intercepted, interceptValue] = this._repo.valueInterceptorMatched(this._key, fs);

    if (intercepted) {
      const result = EvaluatedFeature.withFeatureStateAndValue(fs, interceptValue);
      return triggerUsage && fs ? this.used(result) : result;
    }

    // we don't have a feature or the types are different, e.g. asking for a boolean and the type is JSON
    if (!fs) {
      return undefined;
    }

    if (this._ctx != null && fs.strategies?.length) {
      const matched = this._repo.apply(fs!.strategies || [], this._key, fs.id, this._ctx);

      if (matched.matched) {
        const result = EvaluatedFeature.withFeatureStateValueAndStrategy(
          fs,
          matched.value,
          matched.strategyId!,
        );
        return triggerUsage ? this.used(result) : result;
      }
    }

    const result = EvaluatedFeature.withFeatureState(fs);
    return triggerUsage ? this.used(result) : result;
  }

  private used(value: EvaluatedFeature): EvaluatedFeature {
    if (this._ctx) {
      this._ctx.used(value);
    } else {
      this._repo.used(value, undefined, undefined);
    }

    return value;
  }

  private _castType(
    type: FeatureValueType,
    v?: EvaluatedFeature,
    parseJson = false,
  ): FeatureValue | unknown {
    const value = v?.value;

    if (value === undefined || value === null) {
      return undefined;
    }

    const sValue = value.toString();
    if (type === FeatureValueType.Boolean) {
      return typeof value === "boolean" ? value : "true" === sValue;
    } else if (type === FeatureValueType.String) {
      return sValue;
    } else if (type === FeatureValueType.Number) {
      if (typeof value === "number") {
        return value;
      }

      if (sValue.includes(".")) {
        return parseFloat(sValue);
      }

      return parseInt(sValue);
    } else if (type === FeatureValueType.Json) {
      if (parseJson) {
        try {
          return JSON.parse(sValue) as unknown;
        } catch {
          return {} as unknown; // default return empty obj
        }
      }

      return sValue;
    } else {
      return undefined;
    }
  }

  get value(): FeatureValue {
    return this.internalGetValue(true)?.value;
  }

  get untrackedValue(): FeatureValue {
    return this.internalGetValue(true)?.value;
  }

  get featureProperties(): Record<string, string> | undefined {
    return this.featureState()?.fp ?? undefined;
  }
}
