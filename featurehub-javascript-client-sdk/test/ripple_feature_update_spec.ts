import {
  AnalyticsCollector,
  BaseClientContext,
  ClientContext,
  FeatureRolloutStrategy,
  FeatureRolloutStrategyAttribute,
  FeatureState,
  FeatureStateHolder,
  FeatureStateValueInterceptor,
  FeatureValueType,
  InterceptorValueMatch,
  InternalFeatureRepository,
  PostLoadNewFeatureStateAvailableListener,
  Readyness,
  ReadynessListener,
  RolloutStrategyAttributeConditional,
  RolloutStrategyFieldType,
  SSEResultState
} from '../app';
import { Arg, Substitute, SubstituteOf } from '@fluffy-spoon/substitute';
import { FeatureStateBaseHolder } from '../app/feature_state_holders';
import { expect } from 'chai';
import { Applied, ApplyFeature } from '../app/strategy_matcher';

class TestingContext extends BaseClientContext {
  build(): Promise<ClientContext> {
    throw new Error('Method not implemented.');
  }

  feature(name: string): FeatureStateHolder<any> {
    throw new Error('Method not implemented.');
  }

  close(): void {
    throw new Error('Method not implemented.');
  }

  constructor(repository: InternalFeatureRepository) {
    super(repository);
  }
}

class FakeInternalRepository implements InternalFeatureRepository {
  private applier = new ApplyFeature();

  notReady(): void {
    throw new Error('Method not implemented.');
  }

  notify(state: SSEResultState, data: any) {
    throw new Error('Method not implemented.');
  }

  valueInterceptorMatched(key: string): InterceptorValueMatch {
    return new InterceptorValueMatch(undefined);
  }

  apply(strategies: FeatureRolloutStrategy[], key: string, featureValueId: string, context: ClientContext): Applied {
    return this.applier.apply(strategies, key, featureValueId, context);
  }

  readyness: Readyness = Readyness.Ready;
  catchAndReleaseMode = false;

  logAnalyticsEvent(action: string, other?: Map<string, string>, ctx?: ClientContext) {
    throw new Error('Method not implemented.');
  }

  hasFeature(key: string): FeatureStateHolder<any> {
    throw new Error('Method not implemented.');
  }

  feature(key: string): FeatureStateHolder<any> {
    throw new Error('Method not implemented.');
  }

  getFeatureState<T = any>(key: string): FeatureStateHolder<T> {
    throw new Error('Method not implemented.');
  }

  release(disableCatchAndRelease?: boolean): Promise<void> {
    throw new Error('Method not implemented.');
  }

  simpleFeatures(): Map<string, string> {
    throw new Error('Method not implemented.');
  }

  getFlag(key: string): boolean {
    throw new Error('Method not implemented.');
  }

  getString(key: string): string {
    throw new Error('Method not implemented.');
  }

  getJson(key: string): string {
    throw new Error('Method not implemented.');
  }

  getNumber(key: string): number {
    throw new Error('Method not implemented.');
  }

  isSet(key: string): boolean {
    throw new Error('Method not implemented.');
  }

  addValueInterceptor(interceptor: FeatureStateValueInterceptor): void {
    throw new Error('Method not implemented.');
  }

  addReadynessListener(listener: ReadynessListener): number {
    throw new Error('Method not implemented.');
  }

  addReadinessListener(listener: ReadynessListener, ignoreNotReadyOnRegister?: boolean): number {
    throw new Error('Method not implemented.');
  }

  removeReadinessListener(listener: number | ReadynessListener) {
    throw new Error('Method not implemented.');
  }

  addAnalyticCollector(collector: AnalyticsCollector): void {
    throw new Error('Method not implemented.');
  }

  addPostLoadNewFeatureStateAvailableListener(listener: PostLoadNewFeatureStateAvailableListener): number {
    throw new Error('Method not implemented.');
  }

  removePostLoadNewFeatureStateAvailableListener(listener: number | PostLoadNewFeatureStateAvailableListener) {
    throw new Error('Method not implemented.');
  }

}


describe('When checking for listeners triggering on strategy changes', () => {
  let repo: FakeInternalRepository;
  let applied: ApplyFeature;

  beforeEach(() => {
    repo = new FakeInternalRepository();
  });

  it('should ripple listener changes down', () => {
    const key = 'feature-value';
    const f1 = new FeatureStateBaseHolder(repo, key);
    const ctx = new TestingContext(repo).attributeValue('testing', 'x');

    let listener1Result: any = undefined;
    let listener2Result: any = undefined;
    let listener1TriggerCounter = 0;
    let listener2TriggerCounter = 0;

    const listener1 = f1.addListener((ft1) => {
      listener1Result = ft1;
      listener1TriggerCounter++;
    });

    const listener2 = f1.withContext(ctx).addListener((ft1) => {
      listener2Result = ft1;
      listener2TriggerCounter++;
    });

    const feature1 = {
      id: '1', key: key, l: false,
      version: 1, type: FeatureValueType.Boolean,
      value: false,
      strategies: [{
        id: 'abcd', value: true, attributes: [{
          conditional: RolloutStrategyAttributeConditional.Equals,
          fieldName: 'testing',
          type: RolloutStrategyFieldType.String,
          values: ['x']
        } as FeatureRolloutStrategyAttribute]
      } as FeatureRolloutStrategy]
    } as FeatureState;

    f1.setFeatureState(feature1);

    expect(listener1Result).to.not.be.undefined;
    expect(listener2Result).to.not.be.undefined;
    const l1Result = listener1Result as FeatureStateHolder<boolean>;
    const l2Result = listener2Result as FeatureStateHolder<boolean>;
    expect(l1Result?.flag).to.be.false;
    expect(l2Result?.flag).to.be.true;
    expect(listener2TriggerCounter).to.eq(1);
    expect(listener1TriggerCounter).to.eq(1);

    const featureV2 = {
      id: '1', key: key, l: false,
      version: 2, type: FeatureValueType.Boolean,
      value: false,
      strategies: [{
        id: 'abcd', value: false, attributes: [{
          conditional: RolloutStrategyAttributeConditional.Equals,
          fieldName: 'testing',
          type: RolloutStrategyFieldType.String,
          values: ['y']
        } as FeatureRolloutStrategyAttribute]
      } as FeatureRolloutStrategy]
    } as FeatureState;

    f1.setFeatureState(featureV2);
    expect(listener2TriggerCounter).to.eq(2); // this should trigger again as the strategy changed
    expect(listener1TriggerCounter).to.eq(1);
    expect(listener2Result.flag).to.be.false;
  });
});