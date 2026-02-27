import { FHLog } from "../feature_hub_config";
import type { FeatureHubRepository } from "../featurehub_repository";
import { type UsagePlugin } from "./usage";

export class UsageAdapter {
  private readonly plugins: Array<UsagePlugin> = [];
  private readonly repository: FeatureHubRepository;
  private readonly usageStreamHandler: number;

  constructor(repository: FeatureHubRepository) {
    this.repository = repository;
    this.usageStreamHandler = repository.registerUsageStream((usage) => {
      this.plugins.forEach((p) => {
        try {
          p.send(usage);
        } catch (e) {
          FHLog.fhLog.error(`Failed to publish usage to plugin ${p} with error ${e}`);
        }
      });
    });
  }

  public close() {
    this.repository.removeUsageStream(this.usageStreamHandler);
  }

  public registerPlugin(plugin: UsagePlugin) {
    this.plugins.push(plugin);
  }
}
