import { Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import type { SinonFakeTimers } from "sinon";
import * as sinon from "sinon";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type FeatureHubConfig,
  FeatureHubPollingClient,
  type FeaturesFunction,
  FHLog,
  fhLog,
  type InternalFeatureRepository,
  PollingBase,
  type PollingService,
} from "../index";

describe("basic polling sdk works as expected", () => {
  let poller: SubstituteOf<PollingService>;
  let repo: SubstituteOf<InternalFeatureRepository>;
  let config: SubstituteOf<FeatureHubConfig>;

  beforeEach(() => {
    poller = Substitute.for<PollingBase>();

    poller.busy.returns?.(false);

    FeatureHubPollingClient.pollingClientProvider = () => poller;

    FHLog.fhLog.trace = (...args: any[]) => {
      console.log("FeatureHub/Trace: ", ...args);
    };

    repo = Substitute.for<InternalFeatureRepository>();
    config = Substitute.for<FeatureHubConfig>();
    config.getHost().returns("http://localhost/");
    config.getApiKeys().returns(["12344"]);
  });

  it("should accept attempt to poll only once when the interval is 0", async () => {
    const p = new FeatureHubPollingClient(repo, config, 0);

    let url: string | undefined = undefined;
    let freq: number | undefined = undefined;
    let callback: FeaturesFunction | undefined;

    poller.poll().resolves();
    poller.busy.returns?.(false);

    FeatureHubPollingClient.pollingClientProvider = (_opt, url1, freq1, callback1) => {
      url = url1;
      freq = freq1;
      callback = callback1;
      return poller;
    };

    await p.poll();

    expect(url).toBe("http://localhost/features?apiKey=12344");
    expect(freq).toBe(0);

    callback!([]);

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    repo.received(1).notify;
  });

  it("should stop and be not startable if it receives a 404", async () => {
    const p = new FeatureHubPollingClient(repo, config, 0);

    poller.poll().rejects(404);

    FeatureHubPollingClient.pollingClientProvider = () => {
      return poller;
    };

    let success: boolean | undefined = undefined;

    await p
      .poll()
      .then(() => (success = true))
      .catch(() => (success = false));

    expect(success).toBe(false);
    expect(p.canStart).toBe(false);
    await p.poll().catch(() => {});

    poller.received(1).poll();
  });

  describe("with timers", () => {
    let clock: SinonFakeTimers;

    beforeAll(function () {
      clock = sinon.useFakeTimers();
    });

    afterAll(function () {
      clock.restore();
    });

    it("should attempt a re-poll after 2 seconds", async function () {
      const p = new FeatureHubPollingClient(repo, config, 2000);

      poller.poll().resolves();

      poller.frequency.returns?.(2000);

      FeatureHubPollingClient.pollingClientProvider = () => {
        return poller;
      };

      await p.poll();
      console.log("tick");
      clock.tick(2020);
      clock.runAll();
      p.close();

      expect(p.canStart).toBe(true); // can still be started
      poller.received(2).poll();
      clock.tick(2000);
      poller.received(2).poll(); // timer isn't firing
    });
  });

  describe("setTimeout in operation", () => {
    let p: FeatureHubPollingClient;

    beforeEach(() => {
      p = new FeatureHubPollingClient(repo, config, 200);
    });

    afterEach(() => {
      p.close();
    });

    it("should attempt to poll the polling client if the header changes, and not if it doesnt", async function () {
      poller.poll().resolves();
      config.clientEvaluated().returns(false);

      FeatureHubPollingClient.pollingClientProvider = () => {
        return poller;
      };

      await p.contextChange("burp");
      expect(p.active);
      await p.contextChange("burp"); // no change
      poller.received(1).attributeHeader("burp");
      await p.contextChange("burp1"); // change
      poller.received(1).attributeHeader("burp");
      poller.received(1).attributeHeader("burp1");
    });

    it("should not finish awaiting until 503, and return fail on close", async () => {
      let counter = 0;

      class StubPoller extends PollingBase {
        constructor() {
          super("", 200, () => {});
          this._busy = false;
        }

        poll(): Promise<void> {
          counter++;
          this._busy = true;

          fhLog.trace(`counter is ${counter} ${p.awaitingFirstSuccess} ${p.active}`);

          if (counter <= 2) {
            expect(p.awaitingFirstSuccess).toBe(true);
            expect(p.active).toBe(true);
          }

          this._busy = false;
          if (counter == 1) {
            fhLog.trace("rejecting with 503");
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

      await p
        .poll()
        .then(() => (success = true))
        .catch(() => (success = false));

      expect(success).toBe(true);
      expect(counter).toBe(2);
    });
  });
});
