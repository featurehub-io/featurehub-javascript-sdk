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
import { setReady } from "../components/FeatureHub";

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
    closeEdge: vi.fn(),
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

// ---------------------------------------------------------------------------

describe("FeatureHub component", () => {
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    mocks = buildMocks();
    fhStatic.set(mocks.mockConfig, mocks.mockContext);
  });

  afterEach(() => {
    setReady(false);
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);
    vi.clearAllMocks();
  });

  it("renders children", () => {
    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key">
        <div>child content</div>
      </FeatureHub>
    ));
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("skips config creation when already configured via FeatureHub.set() (fallback path)", () => {
    const configSpy = vi.spyOn(EdgeFeatureHubConfig, "config");

    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key">
        <div>test</div>
      </FeatureHub>
    ));

    expect(configSpy).not.toHaveBeenCalled();
    configSpy.mockRestore();
  });

  it("calls init() on the config after registering the readiness listener", () => {
    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key">
        <div>test</div>
      </FeatureHub>
    ));

    expect(mocks.mockConfig.addReadinessListener).toHaveBeenCalledOnce();
    expect(mocks.mockConfig.init).toHaveBeenCalledOnce();
  });

  it("sets ready and does not call userKey when listener fires with Ready and no userKey", async () => {
    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key">
        <div>test</div>
      </FeatureHub>
    ));

    mocks.getListener()?.(Readyness.Ready);

    await waitFor(() => expect(mocks.mockUserKey).not.toHaveBeenCalled());
  });

  it("calls userKey and build when listener fires with Ready and userKey prop is set", async () => {
    mocks.mockUserKey.mockReturnValue({ build: vi.fn().mockResolvedValue(mocks.mockContext) });

    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe">
        <div>test</div>
      </FeatureHub>
    ));

    mocks.getListener()?.(Readyness.Ready);

    await waitFor(() => expect(mocks.mockUserKey).toHaveBeenCalledWith("john.doe"));
  });

  it("does not call userKey when listener fires with Failed", async () => {
    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe">
        <div>test</div>
      </FeatureHub>
    ));

    mocks.getListener()?.(Readyness.Failed);

    await waitFor(() => expect(mocks.mockUserKey).not.toHaveBeenCalled());
  });

  it("does not call userKey when listener fires with NotReady", async () => {
    render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe">
        <div>test</div>
      </FeatureHub>
    ));

    mocks.getListener()?.(Readyness.NotReady);

    await waitFor(() => expect(mocks.mockUserKey).not.toHaveBeenCalled());
  });

  it("removes readiness listener and closes edge on cleanup", async () => {
    const { unmount } = render(() => (
      <FeatureHub url="http://localhost" apiKey="test-key">
        <div>test</div>
      </FeatureHub>
    ));

    unmount();

    expect(mocks.mockConfig.removeReadinessListener).toHaveBeenCalledWith(42);
    expect(mocks.mockConfig.closeEdge).toHaveBeenCalled();
  });

  it("creates config via EdgeFeatureHubConfig when not pre-configured", () => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);

    const mockContextCreated = {
      build: vi.fn().mockResolvedValue(undefined),
      feature: vi.fn(),
      userKey: vi.fn().mockReturnThis(),
    };
    const mockConfigCreated = {
      restActive: vi.fn().mockReturnThis(),
      context: vi.fn().mockReturnValue(mockContextCreated),
      addReadinessListener: vi.fn().mockReturnValue(99),
      removeReadinessListener: vi.fn(),
      closeEdge: vi.fn(),
      close: vi.fn(),
      clientEvaluated: vi.fn().mockReturnValue(false),
      init: vi.fn(),
    };

    const configSpy = vi
      .spyOn(EdgeFeatureHubConfig, "config")
      .mockReturnValue(mockConfigCreated as unknown as EdgeFeatureHubConfig);

    render(() => (
      <FeatureHub url="http://localhost:8085" apiKey="abc123" pollInterval={30000}>
        <div>test</div>
      </FeatureHub>
    ));

    expect(configSpy).toHaveBeenCalledWith("http://localhost:8085", "abc123");
    expect(mockConfigCreated.restActive).toHaveBeenCalledWith(30000);

    configSpy.mockRestore();
  });

  it("uses rest-passive connection type when specified", () => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);

    const mockContextCreated = {
      build: vi.fn().mockResolvedValue(undefined),
      feature: vi.fn(),
      userKey: vi.fn().mockReturnThis(),
    };
    const mockConfigCreated = {
      restPassive: vi.fn().mockReturnThis(),
      context: vi.fn().mockReturnValue(mockContextCreated),
      addReadinessListener: vi.fn().mockReturnValue(99),
      removeReadinessListener: vi.fn(),
      closeEdge: vi.fn(),
      close: vi.fn(),
      clientEvaluated: vi.fn().mockReturnValue(false),
      init: vi.fn(),
    };

    vi.spyOn(EdgeFeatureHubConfig, "config").mockReturnValue(
      mockConfigCreated as unknown as EdgeFeatureHubConfig,
    );

    render(() => (
      <FeatureHub
        url="http://localhost"
        apiKey="abc123"
        connectionType="rest-passive"
        pollInterval={10000}
      >
        <div>test</div>
      </FeatureHub>
    ));

    expect(mockConfigCreated.restPassive).toHaveBeenCalledWith(10000);

    vi.restoreAllMocks();
  });
});
