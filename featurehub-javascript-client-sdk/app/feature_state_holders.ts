import { FeatureListener, FeatureListenerHandle, FeatureStateHolder } from './feature_state';
import { FeatureState, FeatureValueType } from './models';
import { ClientContext } from './client_context';
import { InternalFeatureRepository } from './internal_feature_repository';
import { ListenerUtils } from './listener_utils';

export class FeatureStateBaseHolder<T = any> implements FeatureStateHolder<T> {
  protected internalFeatureState: FeatureState | undefined;
  protected _key: string;
  protected listeners: Map<number, FeatureListener> = new Map<number, FeatureListener>();
  protected _repo: InternalFeatureRepository;
  protected _ctx: ClientContext | undefined;
  // eslint-disable-next-line no-use-before-define
  protected parentHolder: FeatureStateBaseHolder | undefined;

  constructor(repository: InternalFeatureRepository, key: string, existingHolder?: FeatureStateBaseHolder) {
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
      this.listeners.set(pos, () => listener(this));
    } else {
      this.listeners.set(pos, listener);
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
    const existingValue = this._getValue();
    const existingLocked = this.locked;

    this.internalFeatureState = fs;

    const changed = existingLocked !== this.featureState()?.l || existingValue !== this._getValue(fs?.type);

    if (changed) {
      this.notifyListeners();
    }

    return changed;
  }

  copy(): FeatureStateHolder {
    return this._copy();
  }

  // we need the internal feature state set to be consistent
  analyticsCopy(): FeatureStateBaseHolder {
    const c = this._copy();
    c.internalFeatureState = this.internalFeatureState;
    return c;
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
    this.notifyListeners(feature);
  }

  protected notifyListeners(feature?: FeatureStateHolder): void {
    this.listeners.forEach((l) => {
      try {
        l(feature || this);
      } catch (e) {
        //
      } // don't care
    });
  }

  private _copy(): FeatureStateBaseHolder {
    const bh = new FeatureStateBaseHolder(this._repo, this._key, this);
    bh.parentHolder = this;
    return bh;
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

  private _getValue(type?: FeatureValueType, parseJson = false): any | undefined {
    if (!type) {
      type = this.getType();
    }
    if (!type) {
      return undefined;
    }

    if (!this.isLocked()) {
      const intercept = this._repo.valueInterceptorMatched(this._key);

      if (intercept?.value) {
        return this._castType(type, intercept.value, parseJson);
      }
    }

    const featureState = this.featureState();
    if (!featureState || (featureState.type !== type)) {
      return undefined;
    }

    if (this._ctx != null && featureState.strategies?.length) {
      const matched = this._repo.apply(featureState!.strategies || [], this._key, featureState.id, this._ctx);

      if (matched.matched) {
        return this._castType(type, matched.value, parseJson);
      }
    }

    return featureState?.value;
  }

  private _castType(type: FeatureValueType, value?: any, parseJson = false): any | undefined {
    if (value == null) {
      return undefined;
    }

    if (type === FeatureValueType.Boolean) {
      return typeof value === 'boolean' ? value : ('true' === value.toString());
    } else if (type === FeatureValueType.String) {
      return value.toString();
    } else if (type === FeatureValueType.Number) {
      if (typeof value === 'number') {
        return value;
      }
      if (value.includes('.')) {
        return parseFloat(value);
      }

      // tslint:disable-next-line:radix
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
}
