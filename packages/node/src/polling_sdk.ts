import {
  FeaturesFunction,
  PollingBase,
  PollingService,
  RestOptions,
} from "featurehub-javascript-core-sdk";

import { createHexHash } from "./crypto-node";

export class NodejsPollingService extends PollingBase implements PollingService {
  constructor(options: RestOptions, url: string, frequency: number, _callback: FeaturesFunction) {
    super(url, frequency, createHexHash, options, _callback);
  }
}
