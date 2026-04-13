import { render, screen, waitFor } from "@solidjs/testing-library";
import {
  type ClientContext,
  EdgeFeatureHubConfig,
  FeatureHub as fhStatic,
  type FeatureHubConfig,
  Readyness,
} from "featurehub-javascript-client-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeatureHub } from "../components";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMocks() {
  const mockBuild = vi.fn().mockResolvedValue(undefined);
  const mockUserKey = vi.fn().mockReturnValue({ build: mockBuild });
  let capturedListener: ((r: Readyness) => void) | undefined;

  const mockConfig = {
    addReadinessListener: vi.fn().mockImplementation((listener: (r: Readyness) => void) => {
      capturedListener = listener;
      return 42;
    }),
    removeReadinessListener: vi.fn(),
    close: vi.fn(),
    clientEvaluated: vi.fn().mockReturnValue(false),
    init: vi.fn(),
  } as unknown as FeatureHubConfig;

  const mockContext = {
    feature: vi.fn(),
    userKey: mockUserKey,
    build: mockBuild,
  } as unknown as ClientContext;

  return { mockConfig, mockContext, mockBuild, mockUserKey, getListener: () => capturedListener };
}

// Builds a fresh config + context mock for the "own config" path
// (i.e. when fh.isCompletelyConfigured() returns false).
function buildOwnConfigMocks() {
  const mockBuild = vi.fn().mockResolvedValue(undefined);
  const mockContext = {
    build: mockBuild,
    feature: vi.fn(),
    userKey: vi.fn().mockReturnThis(),
  };
  let capturedListener: ((r: Readyness) => void) | undefined;
  const mockConfig = {
    restActive: vi.fn().mockReturnThis(),
    restPassive: vi.fn().mockReturnThis(),
    streaming: vi.fn().mockReturnThis(),
    context: vi.fn().mockReturnValue(mockContext),
    addReadinessListener: vi.fn().mockImplementation((listener: (r: Readyness) => void) => {
      capturedListener = listener;
      return 99;
    }),
    newContext: vi.fn().mockReturnValue(mockContext),
    removeReadinessListener: vi.fn(),
    close: vi.fn(),
    clientEvaluated: vi.fn().mockReturnValue(false),
    init: vi.fn(),
  };
  return { mockConfig, mockContext, mockBuild, getListener: () => capturedListener };
}

// ---------------------------------------------------------------------------

describe("FeatureHub component — shared configuration (fh.set)", () => {
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    mocks = buildMocks();
    fhStatic.set(mocks.mockConfig, mocks.mockContext);
  });

  afterEach(() => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);
    vi.clearAllMocks();
  });

  it("renders children immediately when waitForReady is false", () => {
    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={false}>
        <div>child content</div>
      </FeatureHub>
    ));
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("blocks children rendering until ready when waitForReady is true", async () => {
    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={true}>
        <div>child content</div>
      </FeatureHub>
    ));

    expect(screen.queryByText("child content")).not.toBeInTheDocument();

    mocks.getListener()?.(Readyness.Ready);

    await waitFor(() => expect(screen.getByText("child content")).toBeInTheDocument());
  });

  it("skips EdgeFeatureHubConfig.config() when already configured via FeatureHub.set()", () => {
    const configSpy = vi.spyOn(EdgeFeatureHubConfig, "config");

    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={false}>
        <div>test</div>
      </FeatureHub>
    ));

    expect(configSpy).not.toHaveBeenCalled();
    configSpy.mockRestore();
  });

  it("registers a readiness listener and calls init() on mount", async () => {
    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={false}>
        <div>test</div>
      </FeatureHub>
    ));

    expect(mocks.mockConfig.addReadinessListener).toHaveBeenCalledOnce();
    await waitFor(() => expect(mocks.mockContext.build).toHaveBeenCalledOnce());
  });

  it("calls build() directly when ready fires and no userKey is set", async () => {
    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={false}>
        <div>test</div>
      </FeatureHub>
    ));

    mocks.getListener()?.(Readyness.Ready);

    await waitFor(() => {
      expect(mocks.mockBuild).toHaveBeenCalled();
      expect(mocks.mockUserKey).toHaveBeenCalled();
    });
  });

  it("calls userKey and build when ready fires and userKey prop is set", async () => {
    mocks.mockUserKey.mockReturnValue({ build: vi.fn().mockResolvedValue(mocks.mockContext) });

    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe" waitForReady={false}>
        <div>test</div>
      </FeatureHub>
    ));

    mocks.getListener()?.(Readyness.Ready);

    await waitFor(() => expect(mocks.mockUserKey).toHaveBeenCalledWith("john.doe"));
  });

  it("uses deprecated username prop as fallback when userKey is not set", async () => {
    mocks.mockUserKey.mockReturnValue({ build: vi.fn().mockResolvedValue(mocks.mockContext) });

    render(() => (
      <FeatureHub
        url="http://localhost"
        apiKey="test-key"
        username="legacy.user"
        waitForReady={false}
      >
        <div>test</div>
      </FeatureHub>
    ));

    mocks.getListener()?.(Readyness.Ready);

    await waitFor(() => expect(mocks.mockUserKey).toHaveBeenCalledWith("legacy.user"));
  });

  it("does not call build when readiness is Failed", async () => {
    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe" waitForReady={false}>
        <div>test</div>
      </FeatureHub>
    ));

    mocks.getListener()?.(Readyness.Failed);

    await waitFor(() => expect(mocks.mockUserKey).toHaveBeenCalled());
    expect(mocks.mockBuild).toHaveBeenCalled();
  });

  it("does not call build when readiness is NotReady", async () => {
    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe" waitForReady={false}>
        <div>test</div>
      </FeatureHub>
    ));

    mocks.getListener()?.(Readyness.NotReady);

    await waitFor(() => expect(mocks.mockUserKey).toHaveBeenCalled());
    expect(mocks.mockBuild).toHaveBeenCalled();
  });

  it("removes readiness listener on cleanup and does NOT close shared config", () => {
    const { unmount } = render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={false}>
        <div>test</div>
      </FeatureHub>
    ));

    unmount();

    expect(mocks.mockConfig.removeReadinessListener).toHaveBeenCalledWith(42);
    expect(mocks.mockConfig.close).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("FeatureHub component — own configuration (EdgeFeatureHubConfig.config)", () => {
  afterEach(() => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);
    vi.clearAllMocks();
  });

  it("creates config via EdgeFeatureHubConfig when not pre-configured", async () => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);

    const { mockConfig, mockContext } = buildOwnConfigMocks();
    const configSpy = vi
      .spyOn(EdgeFeatureHubConfig, "config")
      .mockReturnValue(mockConfig as unknown as EdgeFeatureHubConfig);

    render(() => (
      <FeatureHub
        url="http://localhost:8085"
        apiKey="abc123"
        pollInterval={30000}
        waitForReady={false}
      >
        <div>test</div>
      </FeatureHub>
    ));

    expect(configSpy).toHaveBeenCalledWith("http://localhost:8085", "abc123");
    expect(mockConfig.restActive).toHaveBeenCalledWith(30000);
    expect(mockConfig.addReadinessListener).toHaveBeenCalledOnce();
    await waitFor(() => expect(mockContext.build).toHaveBeenCalledOnce());

    configSpy.mockRestore();
  });

  it("calls close() on own config when unmounting", () => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);

    const { mockConfig } = buildOwnConfigMocks();
    const configSpy = vi
      .spyOn(EdgeFeatureHubConfig, "config")
      .mockReturnValue(mockConfig as unknown as EdgeFeatureHubConfig);

    const { unmount } = render(() => (
      <FeatureHub url="http://localhost:8085" apiKey="abc123" waitForReady={false}>
        <div>test</div>
      </FeatureHub>
    ));

    unmount();

    expect(mockConfig.removeReadinessListener).toHaveBeenCalledWith(99);
    expect(mockConfig.close).toHaveBeenCalled();

    configSpy.mockRestore();
  });

  it("sets up rest-passive connection when connectionType is rest-passive", () => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);

    const { mockConfig } = buildOwnConfigMocks();
    vi.spyOn(EdgeFeatureHubConfig, "config").mockReturnValue(
      mockConfig as unknown as EdgeFeatureHubConfig,
    );

    render(() => (
      <FeatureHub
        url="http://localhost"
        apiKey="abc123"
        connectionType="rest-passive"
        pollInterval={10000}
        waitForReady={false}
      >
        <div>test</div>
      </FeatureHub>
    ));

    expect(mockConfig.restPassive).toHaveBeenCalledWith(10000);

    vi.restoreAllMocks();
  });

  it("sets up streaming connection when connectionType is streaming", () => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);

    const { mockConfig } = buildOwnConfigMocks();
    vi.spyOn(EdgeFeatureHubConfig, "config").mockReturnValue(
      mockConfig as unknown as EdgeFeatureHubConfig,
    );

    render(() => (
      <FeatureHub
        url="http://localhost"
        apiKey="abc123"
        connectionType="streaming"
        waitForReady={false}
      >
        <div>test</div>
      </FeatureHub>
    ));

    expect(mockConfig.streaming).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("fires ready listener and builds context when readiness is Ready", async () => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);

    const { mockConfig, mockBuild, getListener } = buildOwnConfigMocks();
    const configSpy = vi
      .spyOn(EdgeFeatureHubConfig, "config")
      .mockReturnValue(mockConfig as unknown as EdgeFeatureHubConfig);

    render(() => (
      <FeatureHub url="http://localhost:8085" apiKey="abc123" waitForReady={false}>
        <div>test</div>
      </FeatureHub>
    ));

    getListener()?.(Readyness.Ready);

    await waitFor(() => expect(mockBuild).toHaveBeenCalled());

    configSpy.mockRestore();
  });
});
