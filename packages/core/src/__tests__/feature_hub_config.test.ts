import { Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import { beforeEach, describe, expect, it } from "vitest";

import { EdgeFeatureHubConfig, type EdgeService, type InternalFeatureRepository } from "../index";

describe("We can initialize the config", () => {
  it("should construct urls properly", () => {
    const fc = new EdgeFeatureHubConfig("http://localhost:8080", "123*345");
    expect(fc.getHost()).toBe("http://localhost:8080/");
    expect(fc.url()).toBe("http://localhost:8080/features/123*345");
  });

  it("should strip off /feature/ if a user provided it", () => {
    const fc = new EdgeFeatureHubConfig("https://feature.featurehub.io/features/", "123*345");
    expect(fc.getHost()).toBe("https://feature.featurehub.io/");
    expect(fc.url()).toBe("https://feature.featurehub.io/features/123*345");
  });

  it("should allow me to specify a config and initialise the config", () => {
    const edge = Substitute.for<EdgeService>();
    EdgeFeatureHubConfig.defaultEdgeServiceSupplier = () => edge;

    const fc = new EdgeFeatureHubConfig("http://localhost:8080", "123*345");
    expect(fc.clientEvaluated()).toBe(true);
    fc.init();

    edge.received(1).poll();
  });

  it("asking a new client side config for edge and repository should repeatedly give the same one", () => {
    const edge = Substitute.for<EdgeService>();
    const edgeProvider = () => edge;
    EdgeFeatureHubConfig.defaultEdgeServiceSupplier = edgeProvider;

    const fc = new EdgeFeatureHubConfig("http://localhost:8080", "123*345");
    expect(fc.edgeServiceProvider()).toBe(edgeProvider);
    expect(fc.edgeServiceProvider()).toBe(edgeProvider);
    const repo = fc.repository();
    expect(repo).not.toBeNull();
    expect(fc.repository()).toBe(repo);
  });

  it("should only create a default edge service implementation once no matter how many contexts are made", () => {
    const edge = Substitute.for<EdgeService>();
    let counter = 0;
    EdgeFeatureHubConfig.defaultEdgeServiceSupplier = () => {
      counter++;
      return edge;
    };

    const fc = new EdgeFeatureHubConfig("http://localhost:8080", "123*345");
    fc.repository(Substitute.for<InternalFeatureRepository>());
    fc.newContext();
    fc.newContext();
    fc.newContext();
    fc.newContext();
    expect(counter).toBe(1);
  });

  it("should create edge services with the repository i provide in a new context", () => {
    const edge = Substitute.for<EdgeService>();
    const repo = Substitute.for<InternalFeatureRepository>();
    const repos: Array<InternalFeatureRepository> = [];
    EdgeFeatureHubConfig.defaultEdgeServiceSupplier = (repo1) => {
      repos.push(repo1);
      return edge;
    };
    const fc = new EdgeFeatureHubConfig("http://localhost:8080", "123*345");
    fc.newContext(repo);
    fc.newContext(repo);
    fc.newContext(repo);
    fc.newContext(repo);
    expect(repos.length).toBe(1);
    expect(repos[0]).toBe(repo);
  });

  describe("server evaluated keys", () => {
    let edge: SubstituteOf<EdgeService>;
    let fc: EdgeFeatureHubConfig;

    beforeEach(() => {
      edge = Substitute.for<EdgeService>();
      EdgeFeatureHubConfig.defaultEdgeServiceSupplier = () => edge;
      fc = new EdgeFeatureHubConfig("http://localhost:8080", "123345");
    });

    it("should allow for the creation of a new context which on building should poll the edge repo", async () => {
      expect(fc.clientEvaluated()).toBe(false);
      await fc.newContext().build();
      edge.received(1).contextChange("");
    });

    it("should return the same context each time i ask for a server evaluated key", () => {
      const c1 = fc.newContext();
      const c2 = fc.newContext();
      const c3 = fc.newContext();

      expect(c1).toBe(c2);
      expect(c1).toBe(c3);
    });

    it("should become initialised when the context is polled", async () => {
      await fc.newContext().build();
      expect(fc.initialized).toBe(true);
      expect(fc.closed).toBe(false);
      await fc.close();
      edge.received(1).close();
      expect(fc.initialized).toBe(false);
      expect(fc.closed).toBe(true);
    });
  });

  it("should allow singletons to work as expected", () => {
    const f1 = EdgeFeatureHubConfig.config("http://localhost:8080", "123345");
    const f2 = EdgeFeatureHubConfig.config("http://localhost:8080", "123345");
    const f3 = EdgeFeatureHubConfig.config("http://localhost:8080", "123346");

    expect(f1).toStrictEqual(f2);
    expect(f1).not.toStrictEqual(f3);
  });
});
