import { render, screen, waitFor } from "@solidjs/testing-library";
import {
  type ClientContext,
  FeatureHub as fhStatic,
  type FeatureHubConfig,
} from "featurehub-javascript-client-sdk";
import { type Accessor } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeatureHub } from "../components";
import { setReady } from "../components/FeatureHub";
import { useFeature } from "../hooks/useFeature";
import { useFeatureHub } from "../hooks/useFeatureHub";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildBaseMocks() {
  const mockConfig = {
    addReadinessListener: vi.fn().mockReturnValue(1),
    removeReadinessListener: vi.fn(),
    closeEdge: vi.fn(),
    close: vi.fn(),
    clientEvaluated: vi.fn().mockReturnValue(false),
    init: vi.fn(),
  } as unknown as FeatureHubConfig;

  const mockContext = {
    feature: vi.fn(),
    userKey: vi.fn().mockReturnThis(),
    build: vi.fn().mockResolvedValue(undefined),
  } as unknown as ClientContext;

  return { mockConfig, mockContext };
}

function Wrapper(props: { children: any }) {
  return (
    <FeatureHub url="http://localhost" apiKey="test-key">
      {props.children}
    </FeatureHub>
  );
}

// ---------------------------------------------------------------------------
// useFeatureHub
// ---------------------------------------------------------------------------

describe("useFeatureHub", () => {
  let mockConfig: FeatureHubConfig;
  let mockContext: ClientContext;

  beforeEach(() => {
    ({ mockConfig, mockContext } = buildBaseMocks());
  });

  afterEach(() => {
    setReady(false);
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);
    vi.clearAllMocks();
  });

  it("returns fallback accessors from FeatureHub.set() when outside wrapper", () => {
    fhStatic.set(mockConfig, mockContext);

    let result: { config: Accessor<FeatureHubConfig>; client: Accessor<ClientContext> } | undefined;

    function TestComponent() {
      result = useFeatureHub();
      return <div />;
    }

    render(() => <TestComponent />);

    expect(result!.config()).toBe(mockConfig);
    expect(result!.client()).toBe(mockContext);
  });

  it("returns config and client from context when inside FeatureHub wrapper", () => {
    fhStatic.set(mockConfig, mockContext);

    let result: { config: Accessor<FeatureHubConfig>; client: Accessor<ClientContext> } | undefined;

    function TestComponent() {
      result = useFeatureHub();
      return <div />;
    }

    render(() => (
      <Wrapper>
        <TestComponent />
      </Wrapper>
    ));

    expect(result!.config()).toBeDefined();
    expect(result!.client()).toBeDefined();
  });

  it("throws when not configured and outside FeatureHub wrapper", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    function TestComponent() {
      useFeatureHub();
      return <div />;
    }

    expect(() => render(() => <TestComponent />)).toThrow(
      "Error invoking useFeatureHub! Make sure your component is wrapped by the top-level <FeatureHub> component!",
    );
  });
});

// ---------------------------------------------------------------------------
// useFeature
// ---------------------------------------------------------------------------

describe("useFeature", () => {
  let mockFeatureHolder: {
    value: unknown;
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    isSet: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockFeatureHolder = {
      value: undefined as unknown,
      addListener: vi.fn().mockReturnValue(1),
      removeListener: vi.fn(),
      isSet: vi.fn().mockReturnValue(false),
    };

    const { mockConfig, mockContext } = buildBaseMocks();
    (mockContext.feature as ReturnType<typeof vi.fn>).mockReturnValue(mockFeatureHolder);
    fhStatic.set(mockConfig, mockContext);
  });

  afterEach(() => {
    setReady(false);
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);
    vi.clearAllMocks();
  });

  function renderFeature<T>(key: string) {
    let accessor: Accessor<T | undefined> | undefined;

    function TestComponent() {
      accessor = useFeature<T>(key);
      return <div data-testid="value">{String(accessor?.())}</div>;
    }

    const result = render(() => (
      <Wrapper>
        <TestComponent />
      </Wrapper>
    ));

    return { ...result, getAccessor: () => accessor };
  }

  it("returns undefined before ready signal fires", () => {
    renderFeature("my_flag");
    expect(screen.getByTestId("value")).toHaveTextContent("undefined");
  });

  it("registers a feature listener when the ready signal fires", async () => {
    renderFeature("my_flag");
    setReady(true);

    await waitFor(() => expect(mockFeatureHolder.addListener).toHaveBeenCalledOnce());
  });

  it("returns the current value immediately when isSet() is true after ready", async () => {
    mockFeatureHolder.value = true;
    mockFeatureHolder.isSet.mockReturnValue(true);

    renderFeature<boolean>("my_flag");
    setReady(true);

    await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("true"));
  });

  it("updates the accessor value when the feature listener fires", async () => {
    let capturedFeatureListener: (() => void) | undefined;
    mockFeatureHolder.addListener.mockImplementation((fn: () => void) => {
      capturedFeatureListener = fn;
      return 1;
    });
    mockFeatureHolder.value = false;

    renderFeature<boolean>("my_flag");
    setReady(true);

    await waitFor(() => expect(capturedFeatureListener).toBeDefined());

    mockFeatureHolder.value = true;
    capturedFeatureListener!();

    await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent("true"));
  });

  it("removes the feature listener on cleanup", async () => {
    const { unmount } = renderFeature("my_flag");
    setReady(true);
    await waitFor(() => expect(mockFeatureHolder.addListener).toHaveBeenCalled());

    unmount();

    expect(mockFeatureHolder.removeListener).toHaveBeenCalledWith(1);
  });
});
