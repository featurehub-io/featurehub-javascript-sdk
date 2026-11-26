import type { ContextRecord } from "./client_context";

export interface EdgeService {
  /**
   * The context of a server-evaluated connection has changed: header is its x-featurehub form, and
   * attributes the context itself, for an edge service that sends it another way (the snapshot client sends
   * it as query parameters).
   */
  contextChange(header: string, attributes?: ContextRecord): Promise<void>;
  clientEvaluated(): boolean;

  // do we need a new one if the header changes?
  requiresReplacementOnHeaderChange(): boolean;

  close(): void;

  poll(fromUsage?: boolean): Promise<void>;
}
