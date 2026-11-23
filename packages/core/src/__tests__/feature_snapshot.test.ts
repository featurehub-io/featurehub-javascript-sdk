import { createHash } from "crypto";
import { describe, expect, it } from "vitest";

import {
  ClientFeatureRepository,
  decodeFeatureSnapshot,
  featureSnapshotEtag,
  FeatureSnapshotFormatError,
  featuresSha,
  type FeatureState,
  FeatureValueType,
  Readyness,
  sha256Hex,
  SSEResultState,
} from "../index";

const feature = (id: string, key: string, version: number, value: unknown = true): FeatureState =>
  ({ id, key, version, type: FeatureValueType.Boolean, value, l: false }) as FeatureState;

describe("sha256Hex", () => {
  it.each([
    "",
    "abc",
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(64),
    "a".repeat(1000),
    "หลิงหลิง ศิริลักษณ์ คอง 鄺玲玲",
  ])("matches Node's SHA-256 for %#", (text) => {
    expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });
});

// featurehub-protocol.yaml encoding.sha.test_vectors
describe("featuresSha", () => {
  it.each([
    [[], "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    [
      [{ id: "only", version: 0 }],
      "03a55f20ac287349c236160cf813e321e0084e7c2cdef7cabf43374a85a971a8",
    ],
    [
      [
        { id: "f3c1a2b4-1d2e-4c5b-9a8b-7c6d5e4f3a2b", version: 3 },
        { id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", version: 12 },
        { id: "a0000000-0000-4000-8000-000000000000", version: 1 },
      ],
      "ffef4b48076b58be67b0abe8baa76b13915242208613701a2d3a8328e3eb4ef1",
    ],
    [
      [
        { id: "f1", version: 2 },
        { id: "f2", version: 1 },
      ],
      "90efe21f27585227b23a9782d8aabd8b5139cda839df1a0b8b60fe4c6673c9fd",
    ],
  ])("reproduces the spec vector %#", (features, sha) => {
    expect(featuresSha(features)).toBe(sha);
  });

  it("quotes the sha as the ETag", () => {
    expect(featureSnapshotEtag("abc")).toBe('"abc"');
  });
});

// feature-snapshot-protocol.yaml encoding.feature_snapshot.decoding
describe("decodeFeatureSnapshot", () => {
  const features = [feature("f1", "always_wonder", 2), feature("f2", "keep_silent", 1)];
  const sha = "90efe21f27585227b23a9782d8aabd8b5139cda839df1a0b8b60fe4c6673c9fd";

  it.each([
    ["a snapshot object", { sha, features }],
    ["its JSON", JSON.stringify({ sha, features })],
    ["an object without a sha", { features }],
    ["a bare array of features", features],
    ["the JSON of a bare array", JSON.stringify(features)],
  ])("reads %s", (_name, data) => {
    expect(decodeFeatureSnapshot(data)).toEqual({ sha, features });
  });

  it.each([
    ["invalid JSON", "{features"],
    ["no features", { sha }],
    ["features that is not an array", { features: { key: "orm" } }],
    ["a feature without a version", [{ id: "f1", key: "orm", type: "BOOLEAN" }]],
    ["a feature with a null version", [{ id: "f1", key: "orm", type: "BOOLEAN", version: null }]],
    ["a feature without an id", [{ key: "orm", type: "BOOLEAN", version: 1 }]],
    ["a feature with a bad type", [{ id: "f1", key: "orm", type: "COLOUR", version: 1 }]],
    ["a number", 7],
    ["null", null],
    ["HTML", "<html>chago</html>"],
  ])("rejects %s", (_name, data) => {
    expect(() => decodeFeatureSnapshot(data)).toThrow(FeatureSnapshotFormatError);
  });
});

describe("the repository's snapshot support", () => {
  it("keeps featuresSha current as features change, leaving out keys that were only asked for", () => {
    const repo = new ClientFeatureRepository();
    repo.feature("kornaphat"); // asked for, never delivered

    expect(repo.featuresSha).toBe(featuresSha([]));

    repo.notify(
      SSEResultState.Features,
      [feature("f1", "orm", 1), feature("f2", "ling", 1)],
      "test",
    );
    expect(repo.featuresSha).toBe(
      featuresSha([
        { id: "f1", version: 1 },
        { id: "f2", version: 1 },
      ]),
    );

    repo.notify(SSEResultState.Feature, feature("f1", "orm", 2, false), "test");
    expect(repo.featuresSha).toBe(
      featuresSha([
        { id: "f1", version: 2 },
        { id: "f2", version: 1 },
      ]),
    );

    repo.notify(SSEResultState.DeleteFeature, feature("f2", "ling", 1), "test");
    expect(repo.featuresSha).toBe(featuresSha([{ id: "f1", version: 2 }]));
  });

  it("gives copies of the features, so changing them changes nothing held", () => {
    const repo = new ClientFeatureRepository();
    repo.notify(SSEResultState.Features, [feature("f1", "orm", 1)], "test");

    const copies = repo.featureStates();
    copies[0]!.value = false;

    expect(repo.feature("orm").flag).toBe(true);
  });

  it("loads a snapshot as a full set, and the round trip keeps the SHA (snapshot-roundtrip)", () => {
    const server = new ClientFeatureRepository();
    server.notify(
      SSEResultState.Features,
      [feature("f1", "orm", 3), feature("f2", "ling", 1)],
      "test",
    );

    const client = new ClientFeatureRepository();
    const loaded = client.loadFeatureSnapshot(
      JSON.stringify({ sha: server.featuresSha, features: server.featureStates() }),
    );

    expect(loaded.sha).toBe(server.featuresSha);
    expect(client.featuresSha).toBe(server.featuresSha);
    expect(client.readyness).toBe(Readyness.Ready);
    expect(client.feature("orm").flag).toBe(true);
  });

  it("leaves the repository unchanged when the data is not a snapshot", () => {
    const repo = new ClientFeatureRepository();
    repo.notify(SSEResultState.Features, [feature("f1", "orm", 1)], "test");

    expect(() => repo.loadFeatureSnapshot("<html>always wonder</html>")).toThrow(
      FeatureSnapshotFormatError,
    );
    expect(repo.feature("orm").exists).toBe(true);
    expect(repo.readyness).toBe(Readyness.Ready);
  });
});
