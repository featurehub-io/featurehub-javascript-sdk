import {
  FeaturesFunction,
  PollingBase,
  PollingService,
  RestOptions,
} from "featurehub-javascript-core-sdk";

import { createBase64UrlSafeHash } from "./crypto-node";

export class NodejsPollingService extends PollingBase implements PollingService {
  constructor(options: RestOptions, url: string, frequency: number, _callback: FeaturesFunction) {
    super(url, frequency, createBase64UrlSafeHash, options, _callback);
  }
}
