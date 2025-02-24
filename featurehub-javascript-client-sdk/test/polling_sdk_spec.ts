/* tslint:disable */
/* eslint-disable */
import { expect } from 'chai';
import { Substitute, SubstituteOf, } from '@fluffy-spoon/substitute';
import {
  FeatureHubConfig,
  FeatureHubPollingClient,
  FeaturesFunction, fhLog, FHLog,
  InternalFeatureRepository,
  PollingBase, PollingService
} from '../app';
import sinon = require('sinon');
import { SinonFakeTimers } from 'sinon';


describe('basic polling sdk works as expected',  () => {
  let poller: SubstituteOf<PollingService>;
  let repo: SubstituteOf<InternalFeatureRepository>;
  let config: SubstituteOf<FeatureHubConfig>;

  beforeEach(() => {
    poller = Substitute.for<PollingBase>();
    // @ts-ignore
    poller.busy.returns(false);

    FeatureHubPollingClient.pollingClientProvider = () => poller;

    FHLog.fhLog.trace = (...args: any[]) => {
      console.log('FeatureHub/Trace: ', ...args);
    };

    repo = Substitute.for<InternalFeatureRepository>();
    config = Substitute.for<FeatureHubConfig>();
    config.getHost().returns('http://localhost/');
    config.getApiKeys().returns(['12344']);
  });


  it('should accept attempt to poll only once when the interval is 0', async () => {
    const p = new FeatureHubPollingClient(repo, config, 0);

    let url: string | undefined = undefined;
    let freq: number | undefined = undefined;
    let callback: FeaturesFunction | undefined;

    poller.poll().resolves();
    // @ts-ignore
    // poller.busy.returns(false);

    FeatureHubPollingClient.pollingClientProvider = (opt, url1, freq1, callback1) => {
      url = url1;
      freq = freq1;
      callback = callback1;
      return poller;
    };

    await p.poll();

    expect(url).to.eq('http://localhost/features?apiKey=12344');
    expect(freq).to.eq(0);

    callback!([]);
    repo.received(1).notify;
  });

  it('should stop and be not startable if it receives a 404', async () => {
    const p = new FeatureHubPollingClient(repo, config, 0);

    poller.poll().rejects(404);

    FeatureHubPollingClient.pollingClientProvider = () => {
      return poller;
    };

    let success: boolean | undefined = undefined;

    await p.poll().then(() => success = true).catch(() => success = false);

    expect(success).to.be.false;
    expect(p.canStart).to.be.false;
    await p.poll().catch(() => {});

    poller.received(1).poll();
  });

  describe('with timers',  () => {
    let clock: SinonFakeTimers;

    before(function () {
      clock = sinon.useFakeTimers();
    });

    after(function () {
      clock.restore();
    });

    it('should attempt a re-poll after 2 seconds', async function () {
      const p = new FeatureHubPollingClient(repo, config, 2000);

      poller.poll().resolves();
      // @ts-ignore
      poller.frequency.returns(2000);

      FeatureHubPollingClient.pollingClientProvider = () => {
        return poller;
      };

      await p.poll();
      console.log('tick');
      clock.tick(2020);
      clock.runAll();
      p.close();

      expect(p.canStart).to.be.true; // can still be started
      poller.received(2).poll();
      clock.tick(2000);
      poller.received(2).poll(); // timer isn't firing
    });
  });

  describe('setTimeout in operation',  () => {
    let p: FeatureHubPollingClient;

    beforeEach(() => {
      p = new FeatureHubPollingClient(repo, config, 200);
    });

    afterEach(() => {
      p.close();
    });

    it('should attempt to poll the polling client if the header changes, and not if it doesnt', async function () {
      poller.poll().resolves();
      config.clientEvaluated().returns(false);

      FeatureHubPollingClient.pollingClientProvider = () => {
        return poller;
      };

      await p.contextChange('burp');
      expect(p.active);
      await p.contextChange('burp'); // no change
      poller.received(1).attributeHeader('burp');
      await p.contextChange('burp1'); // change
      poller.received(1).attributeHeader('burp');
      poller.received(1).attributeHeader('burp1');
    });

    it('should not finish awaiting until 503, and return fail on close', async () => {
      let counter = 0;

      class StubPoller extends PollingBase {
        constructor() {
          super('', 200, () => {});
          this._busy = false;
        }

        poll(): Promise<void> {
          counter++;
          this._busy = true;

          fhLog.trace(`counter is ${counter} ${p.awaitingFirstSuccess} ${p.active}`);

          if (counter <= 2) {
            expect(p.awaitingFirstSuccess).to.be.true;
            expect(p.active).to.be.true;
          }

          this._busy = false;
          if (counter == 1) {
            fhLog.trace('rejecting with 503');
            return Promise.reject(503);
          }

          return Promise.resolve();
        }
      }

      const poller2 = new StubPoller();

      FeatureHubPollingClient.pollingClientProvider = () => {
        return poller2;
      };

      let success: boolean | undefined = undefined;

      await p.poll().then(() => success = true).catch(() => success = false);

      expect(success).to.be.true;
      expect(counter).to.eq(2);
    });
  });

});