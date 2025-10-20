import {
  ClientFeatureRepository,
  EdgeFeatureHubConfig,
  type EdgeService,
  type FeatureHubRepository,
  type FeatureState,
  type FeatureStateValueInterceptor,
  FeatureValueType,
  InterceptorValueMatch,
  SSEResultState,
} from "../index";
import { describe, it, expect, beforeEach } from "vitest";
import { Substitute } from "@fluffy-spoon/substitute";

class KeyValueInterceptor implements FeatureStateValueInterceptor {
  private readonly key: string;
  private readonly value: string;

  constructor(key: string, value: string) {
    this.key = key;
    this.value = value;
  }

  matched(key: string): InterceptorValueMatch {
    return key === this.key
      ? new InterceptorValueMatch(this.value)
      : new InterceptorValueMatch(undefined);
  }

  repository(_repo: FeatureHubRepository): void {}
}

describe("Interceptor functionality works as expected", () => {
  let repo: ClientFeatureRepository;

  beforeEach(() => {
    repo = new ClientFeatureRepository();
  });

  it("should allow us to override unlocked values", () => {
    const features: Array<FeatureState> = [
      { id: "1", key: "banana", version: 1, type: FeatureValueType.Boolean, value: false },
      { id: "1", key: "apricot", version: 1, type: FeatureValueType.Number, value: 16.2 },
      { id: "1", key: "nashi", version: 1, type: FeatureValueType.String, value: "oook" },
      {
        id: "3",
        key: "peach",
        version: 1,
        type: FeatureValueType.Json,
        value: '{"variety": "golden queen"}',
      },
    ];

    repo.notify(SSEResultState.Features, features);

    repo.addValueInterceptor(new KeyValueInterceptor("banana", "true"));
    repo.addValueInterceptor(new KeyValueInterceptor("apricot", "17.3"));
    repo.addValueInterceptor(new KeyValueInterceptor("nashi", "wombat"));
    repo.addValueInterceptor(new KeyValueInterceptor("peach", "{}"));

    expect(repo.feature("banana").getBoolean()).toBe(true);
    expect(repo.feature("apricot").getNumber()).toBe(17.3);
    expect(repo.feature("nashi").getString()).toBe("wombat");
    expect(repo.feature("peach").getRawJson()).toBe("{}");
  });

  it("should not allow us to override locked values", async () => {
    const fhConfig = new EdgeFeatureHubConfig("http://localhost:8080", "123*123");
    fhConfig.repository(repo);
    const edgeService = Substitute.for<EdgeService>();
    edgeService.poll().returns(new Promise<void>(() => {}));
    fhConfig.edgeServiceProvider(() => edgeService);

    const features: Array<FeatureState> = [
      { id: "1", key: "banana", version: 1, type: FeatureValueType.Boolean, l: true, value: false },
      { id: "1", key: "apricot", version: 1, type: FeatureValueType.Number, l: true, value: 16.2 },
      { id: "1", key: "nashi", version: 1, type: FeatureValueType.String, l: true, value: "oook" },
      {
        id: "3",
        key: "peach",
        version: 1,
        type: FeatureValueType.Json,
        l: true,
        value: '{"variety": "golden queen"}',
      },
    ];

    repo.notify(SSEResultState.Features, features);

    fhConfig.addValueInterceptor(new KeyValueInterceptor("banana", "true"));
    fhConfig.addValueInterceptor(new KeyValueInterceptor("apricot", "17.3"));
    fhConfig.addValueInterceptor(new KeyValueInterceptor("nashi", "wombat"));
    fhConfig.addValueInterceptor(new KeyValueInterceptor("peach", "{}"));

    const client = await fhConfig.newContext().build();

    expect(client.feature("banana").getBoolean()).toBe(false);
    expect(client.getBoolean("banana")).toBe(false);
    expect(client.feature("apricot").getNumber()).toBe(16.2);
    expect(client.getNumber("apricot")).toBe(16.2);
    expect(client.feature("nashi").getString()).toBe("oook");
    expect(client.getString("nashi")).toBe("oook");
    expect(client.feature("peach").getRawJson()).toBe('{"variety": "golden queen"}');
    expect(client.getJson("peach")).toEqual({ variety: "golden queen" });
  });
});
