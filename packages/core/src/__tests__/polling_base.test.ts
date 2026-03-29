import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FeatureEnvironmentCollection } from "../models";
import {
  type CryptoProvider,
  type FeaturesFunction,
  PollingBase,
  type RestOptions,
} from "../network";

class TestPoller extends PollingBase {
  // eslint-disable-next-line
  constructor(
    url: string,
    frequency: number,
    createBase64UrlSafeHash: CryptoProvider,
    options: RestOptions,
    callback: FeaturesFunction,
  ) {
    super(url, frequency, createBase64UrlSafeHash, options, callback);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Polling Base polls as expected", () => {
  const baseUrl = "http://localhost:8085";
  let headerMap: Map<string, string> = new Map<string, string>();
  let fetchSpy: any;

  beforeEach(() => {
    headerMap = new Map<string, string>();
  });

  describe("basic poller", async () => {
    let poller: TestPoller;
    let environments: Array<FeatureEnvironmentCollection> | undefined;
    let frequency = 10;

    beforeEach(() => {
      environments = undefined;
      frequency = 10;

      poller = new TestPoller(
        baseUrl,
        frequency,
        async (_a, _data) => "fred",
        {},
        (e) => {
          environments = e;
        },
      );
    });

    it("should reset the polling frequence with a cache updated header", async () => {
      const seconds = 300;

      headerMap.set("cache-control", `max-age=${seconds}`);

      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify([])),
        headers: headerMap,
        status: 200,
        ok: true,
      } as unknown as Response);

      await poller.poll();

      expect(environments).to.deep.eq([]);
      expect(poller.frequency).to.eq(seconds * 1000);
      expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
        baseUrl + "/&contextSha=0",
        expect.anything(),
      );
    });

    it("if it returns not ok it should reject the promises and return the status", async () => {
      let hold: ((value: Response | PromiseLike<Response>) => void) | undefined = undefined;

      fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => {
        console.log("fetch called");
        return new Promise<Response>((resolve) => {
          console.log("grabbed resolve");
          hold = resolve;
        });
      });

      let failures = 0;
      let successes = 0;
      // the first poll should kick off the fetch which will return a promise that doesn't resolve
      console.log("poll1");
      poller
        .poll()
        .then(() => {
          successes++;
          console.log("poll2 success");
        })
        .catch(() => {
          failures++;
        });

      console.log("poll2");
      // this should detect there is already a promise running and stick it in the queue
      poller
        .poll()
        .then(() => {
          successes++;
          console.log("poll2 success");
        })
        .catch(() => {
          failures++;
        });

      await sleep(500);

      // the hold should have been created now because the first poll triggered the fetch
      expect(hold).to.not.be.undefined;

      // now execute the promise and return the data as a failure, which should bounce poll1 and poll2 out
      console.log("calling hold");
      hold!({
        status: 404,
        ok: false,
      } as unknown as Response);
      await sleep(500);
      expect(failures).to.eq(2);
      expect(successes).to.eq(0);
    });

    it("should capture previous poll requests and resolve them all at once on success", async () => {
      let hold: ((value: Response | PromiseLike<Response>) => void) | undefined = undefined;

      fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => {
        return new Promise<Response>((resolve) => {
          hold = resolve;
        });
      });

      let successes = 0;
      let failures = 0;
      // the first poll should kick off the fetch which will return a promise that doesn't resolve
      poller
        .poll()
        .then(() => {
          successes++;
        })
        .catch(() => {
          failures++;
          console.log("poll1 failed");
        });

      // this should detect there is already a promise running and stick it in the queue
      poller
        .poll()
        .then(() => {
          successes++;
        })
        .catch(() => {
          failures++;
          console.log("poll2 failed");
        });

      await sleep(500);

      // the hold should have been created now because the first poll triggered the fetch
      expect(hold).to.not.be.undefined;

      // now execute the promise and return the data as a failure, which should bounce poll1 and poll2 out
      console.log("calling hold");
      hold!({
        status: 200,
        ok: true,
        headers: headerMap,
        text: () => Promise.resolve(JSON.stringify([])),
      } as unknown as Response);
      await sleep(500);
      expect(successes).to.eq(2);
      expect(failures).to.eq(0);
    });

    it("as long as it returns 200, it should be fetched", async () => {
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify([])),
        headers: headerMap,
        status: 200,
        ok: true,
      } as unknown as Response);

      await poller.poll();
      await poller.poll();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("should stop accepting requests and not fetch if the previous request returned a 236", async () => {
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify([])),
        headers: headerMap,
        status: 236,
        ok: true,
      } as unknown as Response);

      await poller.poll();
      expect(poller.stopped).to.be.true;
      await poller.poll();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should not issue a callback if a 304 (no change) is returned", async () => {
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify([])),
        headers: headerMap,
        status: 304,
        ok: false,
      } as unknown as Response);

      await poller.poll();
      expect(environments).to.be.undefined;
    });

    it("a 200 response with an etag should lead to it being presented on the next request", async () => {
      headerMap.set("etag", "1234_etag");

      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify([])),
        headers: headerMap,
        status: 200,
        ok: true,
      } as unknown as Response);

      await poller.poll();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();

      // given: we set a new mock up which returns a 304
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        headers: headerMap,
        status: 304,
        ok: false,
      } as unknown as Response);

      // when: we poll
      await poller.poll();
      // then: the headers should contain the previous etag
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            "if-none-match": "1234_etag",
          }),
        }),
      );
    });

    it("should change the contextSha when attributeValue is passed", async () => {
      await poller.attributeHeader("sausage");

      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify([])),
        headers: headerMap,
        status: 200,
        ok: true,
      } as unknown as Response);

      await poller.poll();

      expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
        baseUrl + "/&contextSha=fred",
        expect.anything(),
      );
    });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });
});
