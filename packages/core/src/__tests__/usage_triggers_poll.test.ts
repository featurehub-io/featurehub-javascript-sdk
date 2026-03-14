import { Arg, Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import { beforeEach, describe, expect, it } from "vitest";

import type { ClientContext } from "../client_context";
import { BaseClientContext } from "../context_impl";
import type { EdgeService } from "../edge_service";
import { type FeatureHubConfig, fhLog } from "../feature_hub_config";
import type { FeatureStateHolder } from "../feature_state";
import type { InternalFeatureRepository } from "../internal_feature_repository";
import { FeatureValueType } from "../models";
import { FeatureHubPollingClient, type PollingService, type RestOptions } from "../network";
import { DefaultUsageProvider } from "../usage/usage";

class TestingContext extends BaseClientContext {
  constructor(repository: InternalFeatureRepository, currentEdge: EdgeService) {
    super(repository);
    this._currentEdge = currentEdge;
  }

  override async build(): Promise<ClientContext> {
    if (this._currentEdge) {
      await this._currentEdge.poll();
    }

    return this;
  }

  override feature(_name: string): FeatureStateHolder {
    return Substitute.for<FeatureStateHolder>();
  }

  override close() {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("usage will trigger polling appropriately", async () => {
  let repo: SubstituteOf<InternalFeatureRepository>;
  let edge: SubstituteOf<EdgeService>;
  let config: SubstituteOf<FeatureHubConfig>;

  beforeEach(() => {
    fhLog.trace = (...args) => console.log(args);

    repo = Substitute.for<InternalFeatureRepository>();
    edge = Substitute.for<EdgeService>();
    config = Substitute.for<FeatureHubConfig>();

    const usageProvider = new DefaultUsageProvider();

    // @ts-expect-error tslint doesn't understand usage
    repo.usageProvider.returns(usageProvider);
  });

  it("usage should trigger a poll request indicating it is from usage", async () => {
    const ctx = new TestingContext(repo, edge);
    ctx.used("feature", "id", 2, FeatureValueType.Number, "env1");

    repo.received(1).recordUsageEvent(Arg.any());
    edge.received(1).poll(true);
  });

  it("usage should trigger polling when the cache timeout has expired", async () => {
    // given: we have a repo
    // and a passive polling context
    const edge = new FeatureHubPollingClient(repo, config, 5000, { active: false } as RestOptions);
    const pollingService = Substitute.for<PollingService>();
    FeatureHubPollingClient.pollingClientProvider = () => pollingService;
    // if someone calls poll, just return a success
    pollingService.poll().returns(new Promise<void>((resolve) => resolve()));
    // @ts-expect-error tslint doesn't understand usage
    pollingService.frequency.returns(200);
    // @ts-expect-error tslint doesn't understand usage
    pollingService.busy.returns(false);
    // given: we have a context
    const ctx = new TestingContext(repo, edge);
    let nextCacheExpiry = edge.nextCacheExpiry;
    expect(nextCacheExpiry).to.not.be.undefined;
    // when: we issue a usage
    for (let count = 0; count < 10; count++) {
      await ctx._used("feature", "id", 2, FeatureValueType.Number, "env1");
    }

    // even a normal poll won't trigger it
    await ctx.build();

    // then: we should have received a single poll message with the rest bounced
    pollingService.received(1).poll();
    for (let count = 1; count < 3; count++) {
      // and: the expiry should be set for at least 200 more than its Date.now()
      expect(edge.nextCacheExpiry).to.be.greaterThan(nextCacheExpiry!);
      expect(edge.nextCacheExpiry).to.be.lessThanOrEqual(Date.now() + 200);
      nextCacheExpiry = edge.nextCacheExpiry;
      // when: we sleep for the cache length
      await sleep(200);
      // and: trigger used again
      await ctx._used("feature", "id", 2, FeatureValueType.Number, "env1");
      // and: even a normal poll won't trigger it
      await ctx.build();
      // then: the poll will fire as expected
      pollingService.received(count + 1).poll();
    }
  });

  it("usage should trigger polling when active polling is used if no polling service exists, ", async () => {
    // and a passive polling context
    const edge = new FeatureHubPollingClient(repo, config, 5000, { active: true } as RestOptions);
    const pollingService = Substitute.for<PollingService>();
    FeatureHubPollingClient.pollingClientProvider = () => pollingService;
    // if someone calls poll, just return a success
    pollingService.poll().returns(new Promise<void>((resolve) => resolve()));
    // @ts-expect-error tslint doesn't understand usage
    pollingService.frequency.returns(5000);
    // and: tell it the polling service is already busy
    // @ts-expect-error tslint doesn't understand usage
    pollingService.busy.returns(false);
    await edge.poll(true);
    pollingService.received(1).poll();
    expect(edge.isTimerSet).to.be.true;

    // given: we have a context
    const ctx = new TestingContext(repo, edge);
    // when: we issue a usage
    await ctx._used("feature", "id", 2, FeatureValueType.Number, "env1");

    // then: it should have not triggered another poll
    pollingService.received(1).poll();
  });
});
