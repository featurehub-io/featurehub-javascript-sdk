import {
  ClientFeatureRepository,
  EdgeFeatureHubConfig,
  FeatureState,
  FeatureValueType,
  Readyness,
  SSEResultState
} from '../app';
import { expect } from 'chai';

describe('Readiness listeners should fire on appropriate events', () => {
  let repo: ClientFeatureRepository;

  beforeEach(() => {
    repo = new ClientFeatureRepository();
  });

  it('should allow us to set readiness on the config', () => {
    const fhConfig = new EdgeFeatureHubConfig('http://localhost:8080', '123*123');
    fhConfig.repository(repo);
    let readinessTrigger = 0;
    let lastReadiness: Readyness = undefined;
    const triggerHandler = fhConfig.addReadinessListener((state) => {
      lastReadiness = state;
      readinessTrigger++;
    });

    expect(fhConfig.readyness).to.eq(Readyness.NotReady);
    expect(readinessTrigger).to.eq(1);

    const features = [
      { id: '1', key: 'banana', version: 1, type: FeatureValueType.Boolean, value: true },
    ];

    repo.notify(SSEResultState.Features, features);

    expect(fhConfig.readyness).to.eq(Readyness.Ready);
    expect(lastReadiness).to.eq(Readyness.Ready);
    expect(readinessTrigger).to.eq(2);

    fhConfig.removeReadinessListener(triggerHandler);
    repo.notReady();
    // real readiness updates
    expect(fhConfig.readyness).to.eq(Readyness.NotReady);
    // but the trigger does not fire
    expect(readinessTrigger).to.eq(2);
    expect(lastReadiness).to.eq(Readyness.Ready);
  });

  it('should start not ready, receive a list of features and become ready and on failure be failed', () => {

    let readinessTrigger = 0;
    let lastReadiness: Readyness = undefined;
    repo.addReadinessListener((state) => {
      lastReadiness = state;
      return readinessTrigger++;
    });

    expect(repo.readyness).to.eq(Readyness.NotReady);
    expect(readinessTrigger).to.eq(1);

    const features = [
      { id: '1', key: 'banana', version: 1, type: FeatureValueType.Boolean, value: true } as FeatureState,
    ];

    repo.notify(SSEResultState.Features, features);

    expect(repo.readyness).to.eq(Readyness.Ready);
    expect(lastReadiness).to.eq(Readyness.Ready);
    expect(readinessTrigger).to.eq(2);

    repo.notify(SSEResultState.Failure, null);
    expect(repo.readyness).to.eq(Readyness.Failed);
    expect(lastReadiness).to.eq(Readyness.Failed);
    expect(readinessTrigger).to.eq(3);
  });

  it('we should be able to be ready and then be still ready on a bye', () => {
    let readinessTrigger = 0;
    let lastReadiness: Readyness = undefined;
    repo.addReadinessListener((state) => {
      lastReadiness = state;
      return readinessTrigger++;
    });
    const features = [
      { id: '1', key: 'banana', version: 1, type: FeatureValueType.Boolean, value: true } as FeatureState,
    ];

    repo.notify(SSEResultState.Features, features);
    repo.notify(SSEResultState.Bye, undefined);
    expect(repo.readyness).to.eq(Readyness.Ready);
    expect(lastReadiness).to.eq(Readyness.Ready);
    expect(readinessTrigger).to.eq(2);
  });

  it('should allow us to register disinterest in the initial notready status', () => {
    let readinessTrigger = 0;
    let lastReadiness: Readyness = undefined;

    const listener = (state) => {
      lastReadiness = state;
      return readinessTrigger++;
    };

    repo.addReadinessListener(listener, true);

    expect(lastReadiness).to.be.undefined;
    expect(readinessTrigger).to.eq(0);

    const features = [
      { id: '1', key: 'banana', version: 1, type: FeatureValueType.Boolean, value: true } as FeatureState,
    ];

    repo.notify(SSEResultState.Features, features);

    expect(lastReadiness).to.eq(Readyness.Ready);
    expect(readinessTrigger).to.eq(1);
    repo.notReady();
    expect(lastReadiness).to.eq(Readyness.NotReady);
    repo.removeReadinessListener(listener);
    repo.notify(SSEResultState.Features, features);
    expect(lastReadiness).to.eq(Readyness.NotReady);
  });
});
