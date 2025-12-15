import type { AnalyticsCollector } from "./analytics";
import type { ClientContext } from "./client_context";
import { BaseClientContext } from "./context_impl";
import type { CatchReleaseListenerHandler } from "./feature_hub_config";
import type { FeatureStateHolder } from "./feature_state";
import { FeatureStateBaseHolder } from "./feature_state_holders";
import {
  type PostLoadNewFeatureStateAvailableListener,
  Readyness,
  type ReadynessListener,
} from "./featurehub_repository";
import { type FeatureStateValueInterceptor, InterceptorValueMatch } from "./interceptors";
import type { InternalFeatureRepository } from "./internal_feature_repository";
import {
  type FeatureEnvironmentCollection,
  type FeatureRolloutStrategy,
  FeatureValueType,
  SSEResultState,
} from "./models";
import { Applied, ApplyFeature } from "./strategy_matcher";

class LocalFeatureRepository implements InternalFeatureRepository {
  // indexed by key as that what the user cares about
  private features = new Map<string, FeatureStateBaseHolder>();
  private analyticsCollectors = new Array<AnalyticsCollector>();
  private _matchers: Array<FeatureStateValueInterceptor> = [];
  private readonly _applyFeature: ApplyFeature;

  constructor(environment: FeatureEnvironmentCollection, applyFeature?: ApplyFeature) {
    this._applyFeature = applyFeature || new ApplyFeature();

    environment.features?.forEach((fs) => {
      const holder = new FeatureStateBaseHolder(this, fs.key);
      holder.setFeatureState(fs);
      this.features.set(fs.key, holder);
    });
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
    return Readyness.Ready;
  }

  public notify(_state: SSEResultState, _data: any): void {}

  public addValueInterceptor(matcher: FeatureStateValueInterceptor) {
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
    _: PostLoadNewFeatureStateAvailableListener,
  ): CatchReleaseListenerHandler {
    return 0;
  }

  public removePostLoadNewFeatureStateAvailableListener(
    _: PostLoadNewFeatureStateAvailableListener | CatchReleaseListenerHandler,
  ) {}

  public addReadynessListener(listener: ReadynessListener): number {
    return this.addReadinessListener(listener);
  }

  public addReadinessListener(listener: ReadynessListener, _?: boolean): number {
    listener(Readyness.Ready, true);

    return 0;
  }

  public removeReadinessListener(_: ReadynessListener | number) {}

  notReady(): void {}

  public async broadcastReadynessState() {}

  public addAnalyticCollector(collector: AnalyticsCollector): void {
    this.analyticsCollectors.push(collector);
  }

  public simpleFeatures(): Map<string, string | undefined> {
    const vals = new Map<string, string | undefined>();

    this.features.forEach((value, key) => {
      if (value.getKey()) {
        // only include value features
        let val: any;
        switch (
          value.getType() // we need to pick up any overrides
        ) {
          case FeatureValueType.Boolean:
            val = value.getBoolean() ? "true" : "false";
            break;
          case FeatureValueType.String:
            val = value.getString();
            break;
          case FeatureValueType.Number:
            val = value.getNumber();
            break;
          case FeatureValueType.Json:
            val = value.getRawJson();
            break;
          default:
            val = undefined;
        }
        vals.set(key, val === undefined ? val : val.toString());
      }
    });

    return vals;
  }

  public logAnalyticsEvent(action: string, other?: Map<string, string>, ctx?: ClientContext) {
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
  public getFeatureState(key: string): FeatureStateHolder {
    return this.feature(key);
  }

  get catchAndReleaseMode(): boolean {
    return false;
  }

  set catchAndReleaseMode(_value: boolean) {}

  public async release(_disableCatchAndRelease?: boolean): Promise<void> {}

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
}

export class LocalClientContext extends BaseClientContext {
  constructor(environment: FeatureEnvironmentCollection) {
    super(new LocalFeatureRepository(environment));
  }

  async build(): Promise<ClientContext> {
    return this;
  }

  feature(name: string): FeatureStateHolder {
    return this._repository.feature(name).withContext(this);
  }

  close() {}
}
