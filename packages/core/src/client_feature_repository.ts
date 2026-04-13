import type { ClientContext, ContextRecord } from "./client_context";
import type { EvaluatedFeature } from "./evaluated_feature";
import {
  type CatchReleaseListenerHandler,
  fhLog,
  type ReadinessListenerHandle,
} from "./feature_hub_config";
import type { FeatureStateHolder } from "./feature_state";
import { FeatureStateBaseHolder } from "./feature_state_holders";
import {
  type PostLoadNewFeatureStateAvailableListener,
  type RawUpdateFeatureListener,
  Readyness,
  type ReadynessListener,
} from "./featurehub_repository";
import type { FeatureValueInterceptor } from "./interceptors";
import type { InternalFeatureRepository } from "./internal_feature_repository";
import { ListenerUtils } from "./listener_utils";
// leave this here, prevents circular deps
import {
  type FeatureRolloutStrategy,
  type FeatureState,
  FeatureValueType,
  SSEResultState,
} from "./models";
import { Applied, ApplyFeature } from "./strategy_matcher";
import {
  defaultUsageProvider,
  FeatureHubUsageValue,
  type UsageEvent,
  type UsageEventListener,
  type UsageProvider,
} from "./usage/usage";

export class ClientFeatureRepository implements InternalFeatureRepository {
  private hasReceivedInitialState = false;
  // indexed by key as that what the user cares about
  private features = new Map<string, FeatureStateBaseHolder>();
  private readynessState: Readyness = Readyness.NotReady;
  private _readinessListeners: Map<number, ReadynessListener> = new Map<
    number,
    ReadynessListener
  >();
  private _listenerCounter = 1;
  private _usageStreams: Map<number, UsageEventListener> = new Map<number, UsageEventListener>();
  private _rawUpdateListeners: Map<number, RawUpdateFeatureListener> = new Map<
    number,
    RawUpdateFeatureListener
  >();
  private _catchAndReleaseMode = false;
  // indexed by id
  private _catchReleaseStates = new Map<string, FeatureState>();
  private _newFeatureStateAvailableListeners: Map<
    number,
    PostLoadNewFeatureStateAvailableListener
  > = new Map<number, PostLoadNewFeatureStateAvailableListener>();
  private _matchers: Array<FeatureValueInterceptor> = [];
  private readonly _applyFeature: ApplyFeature;
  private _catchReleaseCheckForDeletesOnRelease?: FeatureState[];
  private _usageProvider: UsageProvider = defaultUsageProvider;

  constructor(applyFeature?: ApplyFeature) {
    this._applyFeature = applyFeature || new ApplyFeature();
  }

  registerUsageStream(listener: UsageEventListener): number {
    const counter = this._listenerCounter++;

    this._usageStreams.set(counter, listener);

    return counter;
  }

  get featureKeys(): Array<string> {
    return this.features
      .values()
      .filter((f) => !f.isPhantom)
      .map((f) => f.key)
      .toArray();
  }

  removeUsageStream(handler: number): void {
    this._usageStreams.delete(handler);
  }

  registerRawUpdateFeatureListener(listener: RawUpdateFeatureListener): number {
    const counter = this._listenerCounter++;
    this._rawUpdateListeners.set(counter, listener);
    return counter;
  }

  removeRawUpdateFeatureListener(handler: number): void {
    this._rawUpdateListeners.delete(handler);
  }

  get serverProvidedFeatureKeys(): Array<string> {
    return this.features
      .values()
      .filter((f) => f.exists)
      .map((f) => f.key)
      .toArray();
  }

  public set usageProvider(provider: UsageProvider) {
    this._usageProvider = provider;
  }

  get usageProvider(): UsageProvider {
    return this._usageProvider;
  }

  public apply(
    strategies: Array<FeatureRolloutStrategy>,
    key: string,
    featureValueId: string,
    context: ClientContext,
  ): Applied {
    return this._applyFeature.apply(strategies, key, featureValueId, context);
  }

  public get readyness(): Readyness {
    return this.readynessState;
  }

  public notify(state: SSEResultState, data: unknown, source: string) {
    fhLog.trace(`received ${state} from ${source} ${JSON.stringify(data ?? "<none>")}`);

    if (state !== null && state !== undefined) {
      switch (state) {
        case SSEResultState.Ack: // do nothing, expect state shortly
        case SSEResultState.Bye: // do nothing, we expect a reconnection shortly
          break;
        case SSEResultState.DeleteFeature:
          this.deleteFeature(data as FeatureState);
          this._rawUpdateListeners
            .values()
            .forEach(
              (rul) =>
                void Promise.resolve().then(() => rul.deleteFeature(data as FeatureState, source)),
            );
          break;
        case SSEResultState.Failure:
          this.readynessState = Readyness.Failed;
          if (!this._catchAndReleaseMode) {
            this.broadcastReadynessState(false);
          }
          break;
        case SSEResultState.Feature:
          {
            const fs = data as FeatureState;

            if (this._catchAndReleaseMode) {
              this._catchUpdatedFeatures([fs], false);
            } else {
              if (this.featureUpdate(fs)) {
                this.triggerNewStateAvailable();
              }
            }

            this._rawUpdateListeners
              .values()
              .forEach((rul) => void Promise.resolve().then(() => rul.processUpdate(fs, source)));
          }
          break;
        case SSEResultState.Features:
          {
            const features = (data as FeatureState[]).filter((f) => f?.key !== undefined);
            if (this.hasReceivedInitialState && this._catchAndReleaseMode) {
              this._catchUpdatedFeatures(features, true);
              this._rawUpdateListeners
                .values()
                .forEach(
                  (rul) => void Promise.resolve().then(() => rul.processUpdates(features, source)),
                );
            } else {
              let updated = false;
              features.forEach((f) => (updated = this.featureUpdate(f) || updated));
              this._checkForDeletedFeatures(features);
              this._rawUpdateListeners
                .values()
                .forEach(
                  (rul) => void Promise.resolve().then(() => rul.processUpdates(features, source)),
                );
              this.readynessState = Readyness.Ready;
              if (!this.hasReceivedInitialState) {
                this.hasReceivedInitialState = true;
                this.broadcastReadynessState(true);
              } else if (updated) {
                this.triggerNewStateAvailable();
              }
            }
          }
          break;
        default:
          break;
      }
    }
  }

  /**
   * We have a whole list of all the features come in, we need to make sure that none of the
   * features we have been deleted. If they have, we need to remove them like we received a delete request.
   *
   * @param features
   * @private
   */
  private _checkForDeletedFeatures(features: FeatureState[]) {
    const featureMatch = new Map(this.features);

    features.forEach((f) => featureMatch.delete(f.key));

    if (featureMatch.size > 0) {
      for (const k of featureMatch.keys()) {
        this.deleteFeature({ key: k } as FeatureState);
      }
    }
  }

  public addValueInterceptor(matcher: FeatureValueInterceptor): void {
    this._matchers.push(matcher);
  }

  public close(): void {
    this._matchers.forEach((m) => m.close?.());
    this._matchers.length = 0;
    // these might try and unregister themselves as we close them.
    [...this._rawUpdateListeners.values()].forEach(
      (l) => void Promise.resolve().then(() => l.close()),
    );
    this._rawUpdateListeners.clear();
  }

  public valueInterceptorMatched(
    key: string,
    featureState?: FeatureState,
  ): [boolean, string | boolean | number | undefined] {
    for (const matcher of this._matchers) {
      const [matched, value] = matcher.matched(key, this, featureState);

      if (matched) {
        return [true, value];
      }
    }

    return [false, undefined];
  }

  public addPostLoadNewFeatureStateAvailableListener(
    listener: PostLoadNewFeatureStateAvailableListener,
  ): CatchReleaseListenerHandler {
    const pos = ListenerUtils.newListenerKey(this._newFeatureStateAvailableListeners);

    this._newFeatureStateAvailableListeners.set(pos, listener);

    if (this._catchReleaseStates.size > 0) {
      listener(this);
    }

    return pos;
  }

  public removePostLoadNewFeatureStateAvailableListener(
    listener: PostLoadNewFeatureStateAvailableListener | CatchReleaseListenerHandler,
  ) {
    ListenerUtils.removeListener(this._newFeatureStateAvailableListeners, listener);
  }

  public addReadynessListener(listener: ReadynessListener): ReadinessListenerHandle {
    return this.addReadinessListener(listener);
  }

  public addReadinessListener(
    listener: ReadynessListener,
    ignoreNotReadyOnRegister?: boolean,
  ): ReadinessListenerHandle {
    const pos = ListenerUtils.newListenerKey(this._readinessListeners);

    this._readinessListeners.set(pos, listener);

    if (
      !ignoreNotReadyOnRegister ||
      (ignoreNotReadyOnRegister && this.readynessState != Readyness.NotReady)
    ) {
      // always let them know what it is in case its already ready
      listener(this.readynessState, this.hasReceivedInitialState);
    }

    return pos;
  }

  removeReadinessListener(listener: ReadynessListener | ReadinessListenerHandle) {
    ListenerUtils.removeListener(this._readinessListeners, listener);
  }

  notReady(): void {
    this.readynessState = Readyness.NotReady;
    this.hasReceivedInitialState = false;
    this.broadcastReadynessState(false);
  }

  public broadcastReadynessState(firstState: boolean): void {
    // if there are usage listeners, give them all the features
    if (this._usageStreams.size) {
      const ready = this.usageProvider.createUsageCollectionEvent();

      ready.eventName = "readyness";
      ready.featureValues = this.features
        .values()
        .map((fs) => FeatureHubUsageValue.fromFeature(fs.internalGetValue(false)))
        .filter((s) => s !== undefined)
        .toArray();

      this._usageStreams.values().forEach((v) => v(ready));
    }

    this._readinessListeners.forEach((l) => l(this.readynessState, firstState));
  }

  public simpleFeatures(): Map<string, string | undefined> {
    const vals = new Map<string, string | undefined>();

    this.features.forEach((value, key) => {
      if (value.exists) {
        // only include valid features
        let val: any;
        switch (
          value.getType() // we need to pick up any overrides
        ) {
          case FeatureValueType.Boolean:
            val = value.flag ? "true" : "false";
            break;
          case FeatureValueType.String:
            val = value.str;
            break;
          case FeatureValueType.Number:
            val = value.num;
            break;
          case FeatureValueType.Json:
            val = value.rawJson;
            break;
          default:
            val = undefined;
        }
        vals.set(key, val === undefined ? val : val.toString());
      }
    });

    return vals;
  }

  public hasFeature(key: string): undefined | FeatureStateHolder {
    return this.features.get(key);
  }

  public feature(key: string): FeatureStateHolder {
    let holder = this.features.get(key);

    if (holder === undefined) {
      holder = new FeatureStateBaseHolder(this, key);
      this.features.set(key, holder);
    }

    return holder;
  }

  // deprecated
  public getFeatureState(key: string): FeatureStateHolder {
    return this.feature(key);
  }

  get catchAndReleaseMode(): boolean {
    return this._catchAndReleaseMode;
  }

  set catchAndReleaseMode(value: boolean) {
    if (this._catchAndReleaseMode !== value && !value) {
      this.release(true);
    }
    this._catchAndReleaseMode = value;
  }

  public async release(disableCatchAndRelease?: boolean): Promise<void> {
    while (
      this._catchReleaseStates.size > 0 ||
      this._catchReleaseCheckForDeletesOnRelease !== undefined
    ) {
      const states = [...this._catchReleaseStates.values()];
      this._catchReleaseStates.clear(); // remove all existing items
      states.forEach((fs) => this.featureUpdate(fs));
      if (this._catchReleaseCheckForDeletesOnRelease) {
        this._checkForDeletedFeatures(this._catchReleaseCheckForDeletesOnRelease);
        this._catchReleaseCheckForDeletesOnRelease = undefined;
      }
    }

    if (disableCatchAndRelease === true) {
      this._catchAndReleaseMode = false;
    }
  }

  public getFlag(key: string): boolean | undefined {
    return this.feature(key).getFlag();
  }

  public getString(key: string): string | undefined {
    return this.feature(key).getString();
  }

  public getJson(key: string): string | undefined {
    return this.feature(key).getRawJson();
  }

  public getNumber(key: string): number | undefined {
    return this.feature(key).getNumber();
  }

  public isSet(key: string): boolean {
    return this.feature(key).isSet();
  }

  private _catchUpdatedFeatures(features: FeatureState[], isFullList: boolean) {
    let updatedValues = false;

    if (isFullList) {
      // we have to keep track of all of them because we need to know which ones to delete
      // and the catch release state needs to keep track of only the latest version and make sure
      // it updates the right data
      this._catchReleaseCheckForDeletesOnRelease = features;
    }

    if (features && features.length > 0) {
      features.forEach((f) => {
        const existingFeature = this.features.get(f.key);
        if (
          !existingFeature ||
          !existingFeature.exists ||
          (existingFeature.getKey() &&
            f.version! > (existingFeature.getFeatureState()?.version || -1))
        ) {
          const fs = this._catchReleaseStates.get(f.id);
          if (fs == null) {
            this._catchReleaseStates.set(f.id, f);
            updatedValues = true;
          } else {
            // check it is newer
            if (fs.version === undefined || (f.version !== undefined && f.version > fs.version)) {
              this._catchReleaseStates.set(f.id, f);
              updatedValues = true;
            }
          }
        }
      });
    }
    if (updatedValues) {
      this.triggerNewStateAvailable();
    }
  }

  private triggerNewStateAvailable(): void {
    if (this.hasReceivedInitialState && this._newFeatureStateAvailableListeners.size > 0) {
      if (!this._catchAndReleaseMode || this._catchReleaseStates.size > 0) {
        this._newFeatureStateAvailableListeners.forEach((l) => {
          try {
            l(this);
          } catch (e) {
            fhLog.log("failed", e);
          }
        });
      }
    } else {
      // console.log('new data, no listeners');
    }
  }

  private featureUpdate(fs: FeatureState): boolean {
    if (fs === undefined || fs.key === undefined) {
      return false;
    }

    let holder = this.features.get(fs.key);
    if (holder === undefined) {
      const newFeature = new FeatureStateBaseHolder(this, fs.key, holder);

      this.features.set(fs.key, newFeature);

      holder = newFeature;
    } else if (holder.getFeatureState() !== undefined) {
      const fState = holder.getFeatureState()!;
      if (fs.version! < fState.version!) {
        return false;
      }
    }

    return holder.setFeatureState(fs);
  }

  private deleteFeature(featureState: FeatureState) {
    const holder = this.features.get(featureState.key);

    // because of parallelism we can receive retired features after they have been unretired
    // so we need to check their versions. An actual deleted feature however will have a version of 0
    // and a feature value created as retired will also have a version of zero.
    if (
      holder &&
      (featureState.version === undefined ||
        featureState.version === 0 ||
        featureState.version >= holder.version)
    ) {
      holder.setFeatureState(undefined);
    }
  }

  public used(
    value: EvaluatedFeature,
    attrs: ContextRecord | undefined,
    userKey: string | undefined,
  ): void {
    const usageProvider = this.usageProvider;
    if (usageProvider) {
      // in testing with substitutions this can be undefined
      this.recordUsageEvent(
        usageProvider.createUsageFeature(FeatureHubUsageValue.fromFeature(value)!, attrs, userKey),
      );
    }
  }

  public recordUsageEvent(event: UsageEvent): void {
    this._usageStreams.values().forEach((v) => v(event));
  }
}
