import { EdgeFeatureHubConfig } from './edge_featurehub_config';
import { FeatureHubPollingClient } from './polling_sdk';
import { FeatureHubConfig, fhLog } from './feature_hub_config';
import { FeatureStateHolder } from './feature_state';
import { ClientContext } from './client_context';

export * from './feature_state';
export * from './feature_hub_config';
export * from './edge_service';
export * from './client_feature_repository';
export * from './models/models';
export * from './analytics';
export * from './test_sdk';
export * from './polling_sdk';
export * from './middleware';
export * from './baggage_header';
export * from './interceptors';
export * from './client_context';
export * from './internal_feature_repository';
export * from './context_impl';
export * from './featurehub_repository';
export * from './edge_featurehub_config';
export * from './featurehub_eventsource';
export * from './local_context';

export class FeatureHub {
  private static inBrowser: boolean = (typeof window !== 'undefined' && typeof document !== 'undefined');

  public static feature<T = any>(key: string): FeatureStateHolder<T> { return this.context.feature(key); }

  public static set(config: FeatureHubConfig, context: ClientContext) {
    window['fhConfig'] = config;
    window['fhContext'] = context;
  }

  public static get context(): ClientContext {
    if (this.inBrowser) {
      const fhContext = window['fhContext'];
      if (fhContext) {
        return fhContext;
      }
    }

    throw new Error('No FeatureHub context defined');
  }

  public static get config(): FeatureHubConfig {
    if (this.inBrowser) {
      const fhConfig = window['fhConfig'];
      if (fhConfig) {
        return fhConfig;
      }
    }

    throw new Error('No FeatureHub config defined');
  }

  public static _initialize() {
    if (this.inBrowser) {
      // check for a meta tag with the featurehub API key and url
      const metaTags = document.getElementsByTagName('meta');
      const apiKeys: Array<string> = [];
      let pollInterval: string | undefined;
      let url: string | undefined;
      const params: Array<Array<string>> = [];

      for (let count = 0; count < metaTags.length; count++) {
        const name = metaTags[count].getAttribute('name');
        const content = metaTags[count].content;
        if (name === 'featurehub-url') {
          url = content;
        } else if (name === 'featurehub-apiKey') {
          apiKeys.push(content);
        } else if (name === 'featurehub-interval') {
          pollInterval = content;
        } else if (name?.startsWith('featurehub-')) {
          params.push([name.substring(11), content]);
        }
      }

      if (apiKeys.length > 0) {
        if (pollInterval) {
          fhLog.trace('setting polling interval to', pollInterval);
          EdgeFeatureHubConfig.defaultEdgeServiceSupplier = (repo, config) => new FeatureHubPollingClient(repo, config, parseInt(pollInterval));
        }

        const config = EdgeFeatureHubConfig.config(url || 'https://app.featurehub.io/vanilla', apiKeys[0]);

        if (apiKeys.length > 1) {
          for (let count = 1; count < apiKeys.length; count++) {
            config.apiKey(apiKeys[count]);
          }
        }

        const context = config.newContext();
        for (let count = 0; count < params.length; count++) {
          context.attributeValue(params[count][0], params[count][1]);
        }

        context.build();

        this.set(config, context);
      }
    }
  }

  static close() {
    this.config.close();
  }
}

FeatureHub._initialize();
