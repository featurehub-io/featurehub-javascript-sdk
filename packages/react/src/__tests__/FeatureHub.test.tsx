import { act, render, screen } from "@testing-library/react";
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
  let capturedListener: ((r: Readyness, firstTimeReady: boolean) => Promise<void>) | undefined;

  const mockConfig = {
    addReadinessListener: vi.fn().mockImplementation((listener: any) => {
      capturedListener = listener;
      return 42;
    }),
    removeReadinessListener: vi.fn(),
    closeEdge: vi.fn(),
    close: vi.fn(),
    clientEvaluated: vi.fn().mockReturnValue(false),
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
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);
    vi.clearAllMocks();
  });

  it("renders children", () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key">
        <div>child content</div>
      </FeatureHub>,
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("skips config creation when already configured via FeatureHub.set() (fallback path)", () => {
    const configSpy = vi.spyOn(EdgeFeatureHubConfig, "config");

    render(
      <FeatureHub url="http://localhost" apiKey="test-key">
        <div>test</div>
      </FeatureHub>,
    );

    expect(configSpy).not.toHaveBeenCalled();
    configSpy.mockRestore();
  });

  it("registers a readiness listener on mount", () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key">
        <div>test</div>
      </FeatureHub>,
    );
    expect(mocks.mockConfig.addReadinessListener).toHaveBeenCalledOnce();
  });

  it("calls userKey and build when readiness is Ready and userKey prop is set", async () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe">
        <div>test</div>
      </FeatureHub>,
    );

    await act(async () => {
      await mocks.getListener()?.(Readyness.Ready, true);
    });

    expect(mocks.mockUserKey).toHaveBeenCalledWith("john.doe");
    expect(mocks.mockBuild).toHaveBeenCalled();
  });

  it("does not call userKey when readiness is Ready but no userKey prop", async () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key">
        <div>test</div>
      </FeatureHub>,
    );

    await act(async () => {
      await mocks.getListener()?.(Readyness.Ready, true);
    });

    expect(mocks.mockUserKey).not.toHaveBeenCalled();
  });

  it("does not call userKey when readiness is Failed", async () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe">
        <div>test</div>
      </FeatureHub>,
    );

    await act(async () => {
      await mocks.getListener()?.(Readyness.Failed, false);
    });

    expect(mocks.mockUserKey).not.toHaveBeenCalled();
  });

  it("does not call userKey when readiness is NotReady", async () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe">
        <div>test</div>
      </FeatureHub>,
    );

    await act(async () => {
      await mocks.getListener()?.(Readyness.NotReady, false);
    });

    expect(mocks.mockUserKey).not.toHaveBeenCalled();
  });

  it("removes readiness listener and closes edge on unmount", () => {
    const { unmount } = render(
      <FeatureHub url="http://localhost" apiKey="test-key">
        <div>test</div>
      </FeatureHub>,
    );

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
    };

    const configSpy = vi
      .spyOn(EdgeFeatureHubConfig, "config")
      .mockReturnValue(mockConfigCreated as unknown as EdgeFeatureHubConfig);

    render(
      <FeatureHub url="http://localhost:8085" apiKey="abc123" pollInterval={30000}>
        <div>test</div>
      </FeatureHub>,
    );

    expect(configSpy).toHaveBeenCalledWith("http://localhost:8085", "abc123");
    expect(mockConfigCreated.restActive).toHaveBeenCalledWith(30000);

    configSpy.mockRestore();
  });
});
