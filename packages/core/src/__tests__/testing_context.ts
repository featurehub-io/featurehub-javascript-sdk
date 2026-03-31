import type { ClientContext, ContextRecord } from "../client_context";
import { BaseClientContext } from "../context_impl";
import type { EvaluatedFeature } from "../evaluated_feature";
import type { FeatureStateHolder } from "../feature_state";
import {
  type PostLoadNewFeatureStateAvailableListener,
  Readyness,
  type ReadynessListener,
} from "../featurehub_repository";
import type { FeatureValueInterceptor } from "../interceptors";
import type { InternalFeatureRepository } from "../internal_feature_repository";
import { type FeatureRolloutStrategy, type FeatureState, SSEResultState } from "../models";
import { Applied, ApplyFeature } from "../strategy_matcher";
import {
  defaultUsageProvider,
  type UsageEvent,
  type UsageEventListener,
  type UsageProvider,
} from "../usage/usage";

export class TestingContext extends BaseClientContext {
  async build(): Promise<ClientContext> {
    return this;
  }

  feature(_name: string): FeatureStateHolder {
    return this._repository.feature(_name).withContext(this);
  }

  close(): void {
    throw new Error("Method not implemented.");
  }

  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(repository: InternalFeatureRepository) {
    super(repository);
  }
}

export class FakeInternalRepository implements InternalFeatureRepository {
  addFeatureUpdateAvailableListener(_callback: (fs: FeatureState) => void): number {
    return 0;
  }

  get featureKeys(): Array<string> {
    return [];
  }

  removeFeatureUpdateAvailableListener(_handler: number): void {}

  removeUsageStream(_handler: number): void {}

  get serverProvidedFeatureKeys(): Array<string> {
    return [];
  }

  recordUsageEvent(_event: UsageEvent): void {}

  used(
    _value: EvaluatedFeature,
    _attrs: ContextRecord | undefined,
    _userKey: string | undefined,
  ): void {}

  set usageProvider(_provider: UsageProvider) {}

  get usageProvider(): UsageProvider {
    return defaultUsageProvider;
  }

  registerUsageStream(_listener: UsageEventListener): number {
    return 0;
  }
  private applier = new ApplyFeature();

  notReady(): void {
    throw new Error("Method not implemented.");
  }

  close(): void {}

  notify(_state: SSEResultState, _data: any, _source: string) {
    throw new Error("Method not implemented.");
  }

  registerRawUpdateFeatureListener(_listener: any): number {
    return 0;
  }

  removeRawUpdateFeatureListener(_handler: number): void {}

  valueInterceptorMatched(_key: string): [boolean, string | boolean | number | undefined] {
    return [false, undefined];
  }

  apply(
    strategies: FeatureRolloutStrategy[],
    key: string,
    featureValueId: string,
    context: ClientContext,
  ): Applied {
    return this.applier.apply(strategies, key, featureValueId, context);
  }

  readyness = Readyness.Ready;
  catchAndReleaseMode = false;

  hasFeature(_key: string): FeatureStateHolder {
    throw new Error("Method not implemented.");
  }

  feature(_key: string): FeatureStateHolder {
    throw new Error("Method not implemented.");
  }

  getFeatureState(_key: string): FeatureStateHolder {
    throw new Error("Method not implemented.");
  }

  release(_disableCatchAndRelease?: boolean): Promise<void> {
    throw new Error("Method not implemented.");
  }

  simpleFeatures(): Map<string, string> {
    throw new Error("Method not implemented.");
  }

  getFlag(_key: string): boolean {
    throw new Error("Method not implemented.");
  }

  getString(_key: string): string {
    throw new Error("Method not implemented.");
  }

  getJson(_key: string): string {
    throw new Error("Method not implemented.");
  }

  getNumber(_key: string): number {
    throw new Error("Method not implemented.");
  }

  isSet(_key: string): boolean {
    throw new Error("Method not implemented.");
  }

  addValueInterceptor(_interceptor: FeatureValueInterceptor): void {
    throw new Error("Method not implemented.");
  }

  addReadynessListener(_listener: ReadynessListener): number {
    throw new Error("Method not implemented.");
  }

  addReadinessListener(_listener: ReadynessListener, _ignoreNotReadyOnRegister?: boolean): number {
    throw new Error("Method not implemented.");
  }

  removeReadinessListener(_listener: number | ReadynessListener) {
    throw new Error("Method not implemented.");
  }

  addPostLoadNewFeatureStateAvailableListener(
    _listener: PostLoadNewFeatureStateAvailableListener,
  ): number {
    throw new Error("Method not implemented.");
  }

  removePostLoadNewFeatureStateAvailableListener(
    _listener: number | PostLoadNewFeatureStateAvailableListener,
  ) {
    throw new Error("Method not implemented.");
  }
}
