import { UsageEvent, DefaultUsagePlugin } from "featurehub-javascript-core-sdk";
import { Attributes, Span, trace } from "@opentelemetry/api";

export class OpenTelemetryTrackerUsagePlugin extends DefaultUsagePlugin {
  private readonly _prefix: string;
  private readonly _attachAsSpanEvents: boolean;
  // leave, the parent version is true, and we need the message synchronously
  public override canSendAsync = false;

  constructor(prefix: string = "featurehub.", attachAsSpanEvents: boolean = false) {
    super();
    this._prefix = prefix;
    this._attachAsSpanEvents = attachAsSpanEvents;
  }

  // so it can be overridden in tests
  protected getActiveSpan(): Span | undefined {
    return trace.getActiveSpan();
  }

  public send(event: UsageEvent): void {
    const current = this.getActiveSpan();
    if (current && Object.hasOwn(event, "eventName")) {
      const name = (event as any).eventName as string;
      const data = Object.assign(this.defaultPluginAttributes, event.collectUsageRecord());

      // convert the data as required
      const builder: Attributes = {};
      Object.entries(data).forEach(([k, v]) => {
        if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") {
          builder[k] = v;
        } else if (Array.isArray(v)) {
          const elements = v as Array<any>;
          if (elements.filter((item) => typeof item === "string").length == elements.length) {
            builder[k] = v as Array<string>;
          } else if (
            elements.filter((item) => typeof item === "number").length == elements.length
          ) {
            builder[k] = v as Array<number>;
          } else if (
            elements.filter((item) => typeof item === "boolean").length == elements.length
          ) {
            builder[k] = v as Array<boolean>;
          }
        }
      });

      if (this._attachAsSpanEvents) {
        current.addEvent(this.prefix(name), builder);
      } else {
        current.setAttributes(this.prefixBuilder(builder));
      }
    }
  }

  private prefix(name: string): string {
    return this._prefix + name;
  }

  private prefixBuilder(builder: Attributes): Attributes {
    const newBuilder: Attributes = {};

    Object.entries(builder).forEach(([key, value]) => {
      newBuilder[this.prefix(key)] = value;
    });

    return newBuilder;
  }
}
