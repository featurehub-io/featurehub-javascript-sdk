import type { AnalyticsCollector } from "./analytics";
import type { ClientContext } from "./client_context";
import {
  type CatchReleaseListenerHandler,
  fhLog,
  type ReadinessListenerHandle,
} from "./feature_hub_config";
import type { FeatureStateHolder } from "./feature_state";
import { FeatureStateBaseHolder } from "./feature_state_holders";
import {
  type PostLoadNewFeatureStateAvailableListener,
  Readyness,
  type ReadynessListener,
} from "./featurehub_repository";
import { type FeatureStateValueInterceptor, InterceptorValueMatch } from "./interceptors";
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

export class ClientFeatureRepository implements InternalFeatureRepository {
  private hasReceivedInitialState = false;
  // indexed by key as that what the user cares about
  private features = new Map<string, FeatureStateBaseHolder>();
  private analyticsCollectors = new Array<AnalyticsCollector>();
  private readynessState: Readyness = Readyness.NotReady;
  private _readinessListeners: Map<number, ReadynessListener> = new Map<
    number,
    ReadynessListener
  >();
  private _catchAndReleaseMode = false;
  // indexed by id
  private _catchReleaseStates = new Map<string, FeatureState>();
  private _newFeatureStateAvailableListeners: Map<
    number,
    PostLoadNewFeatureStateAvailableListener
  > = new Map<number, PostLoadNewFeatureStateAvailableListener>();
  private _matchers: Array<FeatureStateValueInterceptor> = [];
  private readonly _applyFeature: ApplyFeature;
  private _catchReleaseCheckForDeletesOnRelease?: FeatureState[];

  constructor(applyFeature?: ApplyFeature) {
    this._applyFeature = applyFeature || new ApplyFeature();
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

  public notify(state: SSEResultState, data: any) {
    if (state !== null && state !== undefined) {
      switch (state) {
        case SSEResultState.Ack: // do nothing, expect state shortly
        case SSEResultState.Bye: // do nothing, we expect a reconnection shortly
          break;
        case SSEResultState.DeleteFeature:
          this.deleteFeature(data);
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
          }
          break;
        case SSEResultState.Features:
          {
            const features = (data as [])
              .filter((f: any) => f?.key !== undefined)
              .map((f: any) => f as FeatureState);
            if (this.hasReceivedInitialState && this._catchAndReleaseMode) {
              this._catchUpdatedFeatures(features, true);
            } else {
              let updated = false;
              features.forEach((f) => (updated = this.featureUpdate(f) || updated));
              this._checkForDeletedFeatures(features);
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
   * features we have been deleted. If they have, we need to remove them like we received
   * a delete.
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

  public addValueInterceptor(matcher: FeatureStateValueInterceptor): void {
    this._matchers.push(matcher);

    matcher.repository(this);
  }

  public valueInterceptorMatched(key: string): InterceptorValueMatch | undefined {
    for (const matcher of this._matchers) {
      const m = matcher.matched(key);
      if (m?.value) {
        return m;
      }
    }

    return undefined;
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
    this.broadcastReadynessState(false);
  }

  public broadcastReadynessState(firstState: boolean): void {
    this._readinessListeners.forEach((l) => l(this.readynessState, firstState));
  }

  public addAnalyticCollector(collector: AnalyticsCollector): void {
    this.analyticsCollectors.push(collector);
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

  public logAnalyticsEvent(action: string, other?: Map<string, string>, ctx?: ClientContext): void {
    const featureStateAtCurrentTime: Array<FeatureStateBaseHolder> = [];

    for (const fs of this.features.values()) {
      if (fs.isSet()) {
        const fsVal: FeatureStateBaseHolder =
          ctx == null ? fs : (fs.withContext(ctx) as FeatureStateBaseHolder);
        featureStateAtCurrentTime.push(fsVal.analyticsCopy());
      }
    }

    this.analyticsCollectors.forEach((ac) =>
      ac.logEvent(action, other || new Map<string, string>(), featureStateAtCurrentTime),
    );
  }

  public hasFeature(key: string): undefined | FeatureStateHolder {
    return this.features.get(key);
  }

  public feature<T = any>(key: string): FeatureStateHolder<T> {
    let holder = this.features.get(key);

    if (holder === undefined) {
      holder = new FeatureStateBaseHolder<T>(this, key);
      this.features.set(key, holder);
    }

    return holder;
  }

  // deprecated
  public getFeatureState<T = any>(key: string): FeatureStateHolder<T> {
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
}
