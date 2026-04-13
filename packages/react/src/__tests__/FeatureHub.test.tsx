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
  let capturedListener: ((r: Readyness) => Promise<void>) | undefined;

  const mockConfig = {
    readiness: Readyness.NotReady,
    addReadinessListener: vi.fn().mockImplementation((listener: any) => {
      capturedListener = async (r: Readyness) => {
        (mockConfig as any).readiness = r;
        return await listener(r);
      };
      return 42;
    }),
    removeReadinessListener: vi.fn(),
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

// Builds a fresh config+context mock suitable for testing the "own config" path
// (i.e. when fh.isCompletelyConfigured() returns false).
function buildOwnConfigMocks() {
  const mockBuild = vi.fn().mockResolvedValue(undefined);
  const mockContext = {
    build: mockBuild,
    feature: vi.fn(),
    userKey: vi.fn().mockReturnThis(),
  };
  let capturedListener: ((r: Readyness) => Promise<void>) | undefined;
  const mockConfig = {
    readiness: Readyness.NotReady,
    restActive: vi.fn().mockReturnThis(),
    restPassive: vi.fn().mockReturnThis(),
    streaming: vi.fn().mockReturnThis(),
    context: vi.fn().mockReturnValue(mockContext),
    newContext: vi.fn().mockReturnValue(mockContext),
    addReadinessListener: vi.fn().mockImplementation((listener: any) => {
      capturedListener = async (r: Readyness) => {
        (mockConfig as any).readiness = r;
        return await listener(r);
      };
      return 99;
    }),
    removeReadinessListener: vi.fn(),
    close: vi.fn(),
    clientEvaluated: vi.fn().mockReturnValue(false),
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
    render(
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={false}>
        <div>child content</div>
      </FeatureHub>,
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("blocks children rendering until Ready fires when waitForReady is true", async () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={true}>
        <div>child content</div>
      </FeatureHub>,
    );

    expect(screen.queryByText("child content")).not.toBeInTheDocument();

    await act(async () => {
      await mocks.getListener()?.(Readyness.Ready);
    });

    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("skips EdgeFeatureHubConfig.config() when already configured via FeatureHub.set()", () => {
    const configSpy = vi.spyOn(EdgeFeatureHubConfig, "config");

    render(
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={false}>
        <div>test</div>
      </FeatureHub>,
    );

    expect(configSpy).not.toHaveBeenCalled();
    configSpy.mockRestore();
  });

  it("registers a readiness listener on mount", () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={false}>
        <div>test</div>
      </FeatureHub>,
    );
    expect(mocks.mockConfig.addReadinessListener).toHaveBeenCalledOnce();
  });

  it("calls userKey and build when readiness is Ready and userKey prop is set", async () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe" waitForReady={false}>
        <div>test</div>
      </FeatureHub>,
    );

    // Clear render-time calls so we only assert on what happens in the listener
    vi.clearAllMocks();

    await act(async () => {
      await mocks.getListener()?.(Readyness.Ready);
    });

    expect(mocks.mockUserKey).toHaveBeenCalledWith("john.doe");
    expect(mocks.mockBuild).toHaveBeenCalled();
  });

  it("calls build directly (no userKey) when readiness is Ready and no userKey prop", async () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={false}>
        <div>test</div>
      </FeatureHub>,
    );

    vi.clearAllMocks();

    await act(async () => {
      await mocks.getListener()?.(Readyness.Ready);
    });

    // Render-time code calls userKey(undefined) on re-render — that is expected.
    // What matters is that userKey is never called with an actual user identifier.
    expect(mocks.mockUserKey).not.toHaveBeenCalledWith(expect.any(String));
    expect(mocks.mockBuild).toHaveBeenCalled();
  });

  it("does not call build on client when readiness is Failed", async () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe" waitForReady={false}>
        <div>test</div>
      </FeatureHub>,
    );

    vi.clearAllMocks();

    await act(async () => {
      await mocks.getListener()?.(Readyness.Failed);
    });

    expect(mocks.mockUserKey).not.toHaveBeenCalled();
    expect(mocks.mockBuild).not.toHaveBeenCalled();
  });

  it("does not call build on client when readiness is NotReady", async () => {
    render(
      <FeatureHub url="http://localhost" apiKey="test-key" userKey="john.doe" waitForReady={false}>
        <div>test</div>
      </FeatureHub>,
    );

    vi.clearAllMocks();

    await act(async () => {
      await mocks.getListener()?.(Readyness.NotReady);
    });

    expect(mocks.mockUserKey).not.toHaveBeenCalled();
    expect(mocks.mockBuild).not.toHaveBeenCalled();
  });

  it("uses deprecated username prop as fallback when userKey is not set", async () => {
    render(
      <FeatureHub
        url="http://localhost"
        apiKey="test-key"
        username="legacy.user"
        waitForReady={false}
      >
        <div>test</div>
      </FeatureHub>,
    );

    vi.clearAllMocks();

    await act(async () => {
      await mocks.getListener()?.(Readyness.Ready);
    });

    expect(mocks.mockUserKey).toHaveBeenCalledWith("legacy.user");
  });

  it("removes readiness listener on unmount and does NOT close shared config", () => {
    const { unmount } = render(
      <FeatureHub url="http://localhost" apiKey="test-key" waitForReady={false}>
        <div>test</div>
      </FeatureHub>,
    );

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

  it("creates config via EdgeFeatureHubConfig when not pre-configured", () => {
    const { mockConfig, mockContext } = buildOwnConfigMocks();
    const configSpy = vi
      .spyOn(EdgeFeatureHubConfig, "config")
      .mockReturnValue(mockConfig as unknown as EdgeFeatureHubConfig);

    render(
      <FeatureHub
        url="http://localhost:8085"
        apiKey="abc123"
        pollInterval={30000}
        waitForReady={false}
      >
        <div>test</div>
      </FeatureHub>,
    );

    expect(configSpy).toHaveBeenCalledWith("http://localhost:8085", "abc123");
    expect(mockConfig.restActive).toHaveBeenCalledWith(30000);
    expect(mockConfig.newContext).toHaveBeenCalled();
    expect(mockContext.build).toHaveBeenCalled();

    configSpy.mockRestore();
  });

  it("calls close() on own config when unmounting", () => {
    const { mockConfig } = buildOwnConfigMocks();
    const configSpy = vi
      .spyOn(EdgeFeatureHubConfig, "config")
      .mockReturnValue(mockConfig as unknown as EdgeFeatureHubConfig);

    const { unmount } = render(
      <FeatureHub url="http://localhost:8085" apiKey="abc123" waitForReady={false}>
        <div>test</div>
      </FeatureHub>,
    );

    unmount();

    expect(mockConfig.removeReadinessListener).toHaveBeenCalledWith(99);
    expect(mockConfig.close).toHaveBeenCalled();

    configSpy.mockRestore();
  });

  it("sets up rest-passive connection when connectionType is rest-passive", () => {
    const { mockConfig } = buildOwnConfigMocks();
    const configSpy = vi
      .spyOn(EdgeFeatureHubConfig, "config")
      .mockReturnValue(mockConfig as unknown as EdgeFeatureHubConfig);

    render(
      <FeatureHub
        url="http://localhost:8085"
        apiKey="abc123"
        connectionType="rest-passive"
        pollInterval={30000}
        waitForReady={false}
      >
        <div>test</div>
      </FeatureHub>,
    );

    expect(mockConfig.restPassive).toHaveBeenCalledWith(30000);

    configSpy.mockRestore();
  });

  it("sets up streaming connection when connectionType is streaming", () => {
    const { mockConfig } = buildOwnConfigMocks();
    const configSpy = vi
      .spyOn(EdgeFeatureHubConfig, "config")
      .mockReturnValue(mockConfig as unknown as EdgeFeatureHubConfig);

    render(
      <FeatureHub
        url="http://localhost:8085"
        apiKey="abc123"
        connectionType="streaming"
        waitForReady={false}
      >
        <div>test</div>
      </FeatureHub>,
    );

    expect(mockConfig.streaming).toHaveBeenCalled();

    configSpy.mockRestore();
  });

  it("fires ready listener and builds context when readiness is Ready", async () => {
    const { mockConfig, mockBuild, getListener } = buildOwnConfigMocks();
    const configSpy = vi
      .spyOn(EdgeFeatureHubConfig, "config")
      .mockReturnValue(mockConfig as unknown as EdgeFeatureHubConfig);

    render(
      <FeatureHub url="http://localhost:8085" apiKey="abc123" waitForReady={false}>
        <div>test</div>
      </FeatureHub>,
    );

    vi.clearAllMocks();

    await act(async () => {
      await getListener()?.(Readyness.Ready);
    });

    expect(mockBuild).toHaveBeenCalled();

    configSpy.mockRestore();
  });
});
