import { CoreAnalytics, CoreContext, CorePlugin } from "@segment/analytics-core";
import { ClientContext, DefaultUsagePlugin, UsageEvent } from "featurehub-javascript-core-sdk";

// using docs from https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/server/node#track

export interface SegmentAnalyticsSource {
  (): CoreAnalytics;
}

export class SegmentUsagePlugin extends DefaultUsagePlugin {
  private readonly segmentSource: SegmentAnalyticsSource;
  public anonymous = "anonymous";

  constructor(segmentSource: SegmentAnalyticsSource) {
    super();
    this.segmentSource = segmentSource;
  }

  override send(event: UsageEvent) {
    if (Object.hasOwn(event, "eventName")) {
      const eventName = (event as any).eventName;

      const properties = Object.assign(
        {},
        this.defaultPluginAttributes,
        event.collectUsageRecord(),
      );

      this.segmentSource().track({
        userId: event.userKey || this.anonymous,

        event: eventName,
        properties: properties,
      });
    }
  }
}

export interface FeatureHubCoreContextSource {
  (): ClientContext;
}

export class FeatureHubSegmentEnrichmentPlugin implements CorePlugin {
  public readonly name = "featurehub-segment-enrichment-plugin";
  public readonly version = "1.0.0";
  public readonly type = "enrichment";
  public readonly alternativeNames = [];

  private _contextSource: FeatureHubCoreContextSource | undefined;

  public contextSource(
    contextSource: FeatureHubCoreContextSource,
  ): FeatureHubSegmentEnrichmentPlugin {
    this._contextSource = contextSource;
    return this;
  }

  alias(ctx: CoreContext): Promise<CoreContext> | CoreContext {
    return ctx;
  }

  group(ctx: CoreContext): Promise<CoreContext> | CoreContext {
    return ctx;
  }

  identify(ctx: CoreContext): Promise<CoreContext> | CoreContext {
    return ctx;
  }

  isLoaded(): boolean {
    return true;
  }

  load(_ctx: CoreContext, _instance: CoreAnalytics): Promise<unknown> {
    return Promise.resolve(undefined);
  }

  page(ctx: CoreContext): Promise<CoreContext> | CoreContext {
    return ctx;
  }

  ready(): Promise<unknown> {
    return Promise.resolve(undefined);
  }

  screen(ctx: CoreContext): Promise<CoreContext> | CoreContext {
    return ctx;
  }

  track(ctx: CoreContext): Promise<CoreContext> | CoreContext {
    if (this._contextSource) {
      const source = this._contextSource().getContextUsage();

      ctx.updateEvent("context", source.collectUsageRecord());
    }

    return ctx;
  }

  unload(ctx: CoreContext, _instance: CoreAnalytics): Promise<unknown> | unknown {
    return ctx;
  }
}
