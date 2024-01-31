import { ClientFeatureRepository, FeatureState, FeatureValueType, SSEResultState } from '../app';
import { expect } from 'chai';

describe('if a feature is deleted it becomes undefined', () => {
  let repo: ClientFeatureRepository;
  let features: Array<FeatureState>;

  beforeEach(() => {
    repo = new ClientFeatureRepository();
    features = [
      { id: '1', key: 'banana', version: 2, type: FeatureValueType.Boolean, value: true } as FeatureState,
    ];

    repo.notify(SSEResultState.Features, features);
  });

  it('should allow us to delete a feature', () => {
    expect(repo.feature('banana').flag).to.eq(true);
    expect(repo.getFlag('banana')).to.eq(true);
    expect(repo.feature('banana').exists).to.be.true;
    repo.notify(SSEResultState.DeleteFeature, features[0]);
    // tslint:disable-next-line:no-unused-expression
    expect(repo.feature('banana').exists).to.be.false;
    expect(repo.feature('banana').flag).to.undefined;
    // tslint:disable-next-line:no-unused-expression
    expect(repo.getFlag('banana')).to.undefined;
    // tslint:disable-next-line:no-unused-expression
    expect(repo.isSet('banana')).to.be.false;
    // tslint:disable-next-line:no-unused-expression
    expect(repo.feature('banana').isSet()).to.be.false;
  });

  it('should ignore a delete if the version is lower than the existing version', () => {
    repo.notify(SSEResultState.DeleteFeature,
      { id: '1', key: 'banana', version: 1, type: FeatureValueType.Boolean, value: true } as FeatureState);
    expect(repo.feature('banana').value).to.eq(true);
  });

  it('should delete if the feature version is 0', () => {
    repo.notify(SSEResultState.DeleteFeature,
      { id: '1', key: 'banana', version: 0, type: FeatureValueType.Boolean, value: true } as FeatureState);
    expect(repo.feature('banana').isSet()).to.be.false;
  });

  it('should delete if the feature version is undefined', () => {
    repo.notify(SSEResultState.DeleteFeature,
      { id: '1', key: 'banana', version: undefined, type: FeatureValueType.Boolean, value: true } as FeatureState);
    expect(repo.feature('banana').isSet()).to.be.false;
  });

  it("if features are deleted from FH, on the next poll they won't turn up, so we should indicate they don't exist", () => {
    repo.notify(SSEResultState.Features, features);
    expect(repo.feature('banana').exists).to.be.true;
    repo.notify(SSEResultState.Features, []);
    expect(repo.feature('banana').exists).to.be.false;
  });

  it('should ignore deleting a feature that doesnt exist', () => {
    repo.notify(SSEResultState.DeleteFeature,
        { id: '1', key: 'apple', version: 1, type: FeatureValueType.Boolean, value: true } as FeatureState
    );

    // tslint:disable-next-line:no-unused-expression
    expect(repo.getFeatureState('apple').isSet()).to.be.false;
    expect(repo.getFeatureState('banana').isSet()).to.be.true;
  });
});
