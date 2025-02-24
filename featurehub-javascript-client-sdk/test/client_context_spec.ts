/* tslint:disable */
/* eslint-disable */
import {
  EdgeService,
  FeatureEnvironmentCollection,
  FeatureState, FeatureStateHolder,
  FeatureValueType,
  LocalClientContext,
  StrategyAttributeCountryName,
  StrategyAttributeDeviceName,
  StrategyAttributePlatformName
} from '../app';
import { Substitute, Arg, SubstituteOf } from '@fluffy-spoon/substitute';
import { ClientEvalFeatureContext, ServerEvalFeatureContext, InternalFeatureRepository } from '../app';
import { expect } from 'chai';
import { FeatureStateBaseHolder } from '../app/feature_state_holders';
import { server } from 'sinon';

describe('Client context should be able to encode as expected', () => {
  let repo: SubstituteOf<InternalFeatureRepository>;
  let edge: SubstituteOf<EdgeService>;

  beforeEach(() => {
    repo = Substitute.for<InternalFeatureRepository>();
    edge = Substitute.for<EdgeService>();
    edge.poll().returns(new Promise<void>(() => {}));
  });

  it('the server context should trigger a header change update', async () => {
    const serverContext = new ServerEvalFeatureContext(repo, () => edge);
    await serverContext.userKey('DJElif')
      .sessionKey('VirtualBurningMan')
      .country(StrategyAttributeCountryName.Turkey)
      .platform(StrategyAttributePlatformName.Macos)
      .device(StrategyAttributeDeviceName.Desktop)
      .attribute_value('city', 'istanbul')
      .attribute_values('musical styles', ['deep', 'psychedelic'])
      .version('4.3.2')
      .build();

    repo.received(1).notReady();

    // do it twice to ensure we can reset everything
    await serverContext.userKey('DJElif')
      .sessionKey('VirtualBurningMan')
      .device(StrategyAttributeDeviceName.Desktop)
      .attribute_value('city', 'istanbul')
      .attribute_values('musical styles', ['deep', 'psychedelic'])
      .version('4.3.2')
      .country(StrategyAttributeCountryName.Turkey)
      .platform(StrategyAttributePlatformName.Macos)
      .build();

    edge.received(2).contextChange('city=istanbul,country=turkey,device=desktop,musical styles=deep%2Cpsychedelic,platform=macos,session=VirtualBurningMan,userkey=DJElif,version=4.3.2');
  });

  it('the server context should close the current edge if it has been told to reset edge', async () => {
    const serverContext = new ServerEvalFeatureContext(repo, () => edge);
    edge.requiresReplacementOnHeaderChange().mimicks(() => true);
    await serverContext.userKey('DJElif')
      .sessionKey('VirtualBurningMan').build();
    await serverContext.userKey('DJElif')
      .sessionKey('VirtualBurningMan1').build();
    edge.received(1).close();
    const fhSubst = Substitute.for<FeatureStateHolder<any>>();
    repo.feature('joy').returns(fhSubst);
    fhSubst.isSet().returns(false);
    expect(serverContext.getFlag('joy', true)).to.be.true;
    expect(serverContext.getString('joy', 'loopypro')).to.eq('loopypro');
    expect(serverContext.getJson('joy', { x: 1 })).to.deep.eq({ x: 1 });
    expect(serverContext.getRawJson('joy', 'raw-json')).to.eq('raw-json');
  });

  it('the client context should not trigger a context change or a not ready', async () => {
    const clientContext = new ClientEvalFeatureContext(repo, edge);
    await clientContext.userKey('DJElif')
      .sessionKey('VirtualBurningMan').build();
    repo.received(0).notReady();
    edge.received(0).contextChange(Arg.all());
  });

  it('the static client context should just work', async () => {
    const environment = {
      features: [
        {
          id: '1', key: 'banana', version: 1, type: FeatureValueType.Boolean, value: true,
        } as FeatureState,
      ],
    } as FeatureEnvironmentCollection;
    const context = await new LocalClientContext(environment)
      .userKey('DJElif')
      .sessionKey('VirtualBurningMan')
      .build();

    expect(context.getBoolean('banana')).to.eq(true);
  });
});
