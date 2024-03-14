/// Our goal here is to determine if the appropriate environment variable is loaded and if so,
/// allow overriding of the fh repository. But it has to be addressed in the request context.
///
/// For this we are using the W3C Baggage standard for future supportability

import { PostLoadNewFeatureStateAvailableListener, Readyness, ReadynessListener } from './featurehub_repository';
import { FeatureListener, FeatureListenerHandle, FeatureStateHolder } from './feature_state';
import { FeatureValueType, FeatureRolloutStrategy, SSEResultState } from './models';
import { FeatureStateValueInterceptor, InterceptorValueMatch } from './interceptors';
import { ClientContext } from './client_context';
import { InternalFeatureRepository } from './internal_feature_repository';
import { Applied } from './strategy_matcher';
import { AnalyticsCollector } from './analytics';
import { CatchReleaseListenerHandler, ReadinessListenerHandle } from './feature_hub_config';

class BaggageHolder<T = any> implements FeatureStateHolder<T> {
  protected readonly existing: FeatureStateHolder;
  protected readonly baggageValue: string;

  constructor(existing: FeatureStateHolder, value: string) {
    this.existing = existing;
    this.baggageValue = value;
  }

  // feature properties are not included in baggage, they don't make logical sense.
  get featureProperties(): Record<string, string> | undefined {
      return undefined;
  }

  isEnabled(): boolean {
    return this.getBoolean() === true;
  }

  withContext(param: ClientContext): FeatureStateHolder {
    return new BaggageHolder(this.existing.withContext(param), this.baggageValue);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addListener(listener: FeatureListener<T>): FeatureListenerHandle {
    return 0;
  }

  removeListener(handle: FeatureListener<T> | FeatureListenerHandle) {
  }

  getBoolean(): boolean | undefined {
    if (this.existing.isLocked()) {
      return this.existing.getBoolean();
    }

    return this.existing.getType() === FeatureValueType.Boolean ? ('true' === this.baggageValue) : undefined;
  }

  getFlag(): boolean | undefined {
    return this.getBoolean();
  }

  getKey(): string | undefined {
    return this.existing.getKey();
  }

  getNumber(): number | undefined {
    if (this.existing.isLocked()) {
      return this.existing.getNumber();
    }

    if (this.existing.getType() === FeatureValueType.Number && this.baggageValue !== undefined) {
      if (this.baggageValue.includes('.')) {
        return parseFloat(this.baggageValue);
      } else {
        // tslint:disable-next-line:radix
        return parseInt(this.baggageValue);
      }
    }

    return undefined;
  }

  getRawJson(): string | undefined {
    return undefined;
  }

  getString(): string | undefined {
    if (this.existing.isLocked()) {
      return this.existing.getString();
    }

    if (this.existing.getType() === FeatureValueType.String) {
      return this.baggageValue;
    }

    return undefined;
  }

  getType(): FeatureValueType | undefined {
    return this.existing.getType();
  }

  getVersion(): number | undefined {
    return this.existing.getVersion();
  }

  isLocked(): boolean | undefined {
    return this.existing.isLocked();
  }

  isSet(): boolean {
    return this.value != null;
  }

  triggerListeners(feature: FeatureStateHolder): void {
    this.existing.triggerListeners(feature);
  }

  get enabled(): boolean {
    return this.isEnabled();
  }

  get exists(): boolean {
    return this.existing.exists;
  }

  get flag(): boolean | undefined {
    return this.getBoolean();
  }

  get key(): string | undefined {
    return this.getKey();
  }

  get locked(): boolean | undefined {
    return this.isLocked();
  }

  get num(): number | undefined {
    return this.getNumber();
  }

  get rawJson(): string | undefined {
    return this.getRawJson();
  }

  get str(): string | undefined {
    return this.getString();
  }

  get type(): FeatureValueType | undefined {
    return this.getType();
  }

  get version(): number | undefined {
    return this.getVersion();
  }

  private _valueParseJson() {
    const json = this.getRawJson();
    if (!json) return {};
    try {
      return JSON.parse(json);
    } catch (e) {
      return {};
    }
  }

  get value(): T | undefined {
    if (this.type) {
      const v = {
        [FeatureValueType.Boolean]: this.getBoolean(),
        [FeatureValueType.String]: this.getString(),
        [FeatureValueType.Number]: this.getNumber(),
        [FeatureValueType.Json]: this._valueParseJson(),
      }[this.type];

      return v as T;
    }

    return undefined;
  }
}

class BaggageRepository implements InternalFeatureRepository {
  private readonly repo: InternalFeatureRepository;
  private baggage: Map<string, string>;
  private mappedBaggage = new Map<string, FeatureStateHolder>();

  constructor(repo: InternalFeatureRepository, baggage: Map<string, string>) {
    this.repo = repo;
    this.baggage = baggage;
  }

  public apply(strategies: FeatureRolloutStrategy[], key: string, featureValueId: string, context: ClientContext): Applied {
    return this.repo.apply(strategies, key, featureValueId, context);
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

  get readyness(): Readyness {
    return this.repo.readyness;
  }

  hasFeature(key: string): undefined | FeatureStateHolder {
    return this.feature(key);
  }

  feature<T = any>(key: string): FeatureStateHolder<T> {
    const realFeature = this.repo.hasFeature(key);

    if (realFeature !== undefined && realFeature.getType() !== undefined) {
      if (this.baggage.has(key)) {
        let fh = this.mappedBaggage.get(key);

        // we don't map json types, create it if it isn't there
        if (fh === undefined && realFeature.getType() !== FeatureValueType.Json) {
          fh = new BaggageHolder(realFeature, this.baggage.get(key)!);
          this.mappedBaggage.set(key, fh);
        }

        // return it if we created it
        if (fh !== undefined) {
          return fh;
        }
      }
    }

    // get the original one (or create it if it doesn't exist)
    return this.repo.feature(key);
  }

  logAnalyticsEvent(action: string, other?: Map<string, string>) {
    const otherCopy = other ? other : new Map<string, string>();
    const baggageCopy = new Map<string, string>(
      [...this.baggage.entries(), ...otherCopy.entries()]);

    // merge bother together and

    this.repo.logAnalyticsEvent(action, baggageCopy);
  }

  simpleFeatures(): Map<string, string | undefined> {
    // captures what they are right now
    const features = this.repo.simpleFeatures();

    // override them with what we have
    this.baggage.forEach((value, key) => features.set(key, value));

    return features;
  }

  notReady(): void {
    this.repo.notReady();
  }

  notify(state: SSEResultState, data: any): void {
    this.repo.notify(state, data);
  }

  addValueInterceptor(interceptor: FeatureStateValueInterceptor) {
    this.repo.addValueInterceptor(interceptor);
  }

  valueInterceptorMatched(key: string): InterceptorValueMatch | undefined {
    return this.repo.valueInterceptorMatched(key);
  }

  addReadynessListener(listener: ReadynessListener): ReadinessListenerHandle {
    return this.repo.addReadinessListener(listener);
  }

  addReadinessListener(listener: ReadynessListener, ignoreNotReadyOnRegister?: boolean): ReadinessListenerHandle {
    return this.repo.addReadinessListener(listener, ignoreNotReadyOnRegister);
  }

  removeReadinessListener(listener: ReadynessListener | ReadinessListenerHandle) {
    this.repo.removeReadinessListener(listener);
  }

  addAnalyticCollector(collector: AnalyticsCollector): void {
    this.repo.addAnalyticCollector(collector);
  }

  get catchAndReleaseMode(): boolean {
    return this.repo.catchAndReleaseMode;
  }

  set catchAndReleaseMode(value: boolean) {
    this.repo.catchAndReleaseMode = value;
  }

  addPostLoadNewFeatureStateAvailableListener(listener: PostLoadNewFeatureStateAvailableListener): CatchReleaseListenerHandler {
    return this.repo.addPostLoadNewFeatureStateAvailableListener(listener);
  }

  removePostLoadNewFeatureStateAvailableListener(listener: PostLoadNewFeatureStateAvailableListener | CatchReleaseListenerHandler) {
    this.repo.removePostLoadNewFeatureStateAvailableListener(listener);
  }

  getFeatureState<T = any>(key: string): FeatureStateHolder<T> {
    return this.feature(key);
  }

  release(disableCatchAndRelease?: boolean): Promise<void> {
    return this.repo.release(disableCatchAndRelease);
  }
}

export function featurehubMiddleware(repo: InternalFeatureRepository) {

  return (req: any, res: any, next: any) => {
    let reqRepo: InternalFeatureRepository = repo;

    if (process.env.FEATUREHUB_ACCEPT_BAGGAGE !== undefined) {
      const baggage = req.header('baggage');

      if (baggage != null) {
        const baggageMap = new Map<string, string>();

        // we are expecting a single key/value pair, fhub=
        baggage.split(',')
          .map(b => b.trim())
          .filter(b => b.startsWith('fhub='))
          .forEach(b => {
            //
            const fhub = decodeURIComponent(b.substring(5));
            fhub.split(',')
              .forEach(feature => {
                const parts = feature.split('=');
                if (parts.length === 2) {
                  baggageMap.set(parts[0], decodeURIComponent(parts[1]));
                } else if (parts.length === 1) {
                  baggageMap.set(parts[0], '');
                }
              });
          });

        if (baggageMap.size > 0) {
          reqRepo = new BaggageRepository(repo, baggageMap);
        }
      }
    }

    req.featureHub = reqRepo;

    next();
  };
}
