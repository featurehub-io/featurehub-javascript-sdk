import { act, render, screen } from "@testing-library/react";
import {
  type ClientContext,
  FeatureHub as fhStatic,
  type FeatureHubConfig,
  type FeatureStateHolder,
} from "featurehub-javascript-client-sdk";
import { type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeatureHub } from "../components";
import useFeature from "../hooks/useFeature";
import useFeatureHub from "../hooks/useFeatureHub";
import useFeatureHubClient from "../hooks/useFeatureHubClient";

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function buildBaseMocks() {
  const mockConfig = {
    addReadinessListener: vi.fn().mockReturnValue(1),
    removeReadinessListener: vi.fn(),
    closeEdge: vi.fn(),
    close: vi.fn(),
    clientEvaluated: vi.fn().mockReturnValue(false),
  } as unknown as FeatureHubConfig;

  const mockContext = {
    feature: vi.fn(),
    userKey: vi.fn().mockReturnThis(),
    build: vi.fn().mockResolvedValue(undefined),
  } as unknown as ClientContext;

  return { mockConfig, mockContext };
}

function Wrapper({ children }: { children: ReactElement }) {
  return (
    <FeatureHub url="http://localhost" apiKey="test-key">
      {children}
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
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);
    vi.clearAllMocks();
  });

  it("returns fallback config and client from FeatureHub.set() when outside wrapper", () => {
    fhStatic.set(mockConfig, mockContext);

    let result: { config: FeatureHubConfig; client: ClientContext } | undefined;
    function TestComponent() {
      result = useFeatureHub();
      return null;
    }

    render(<TestComponent />);

    expect(result!.config).toBe(mockConfig);
    expect(result!.client).toBe(mockContext);
  });

  it("returns config and client from context when inside FeatureHub wrapper", () => {
    fhStatic.set(mockConfig, mockContext);

    let result: { config: FeatureHubConfig; client: ClientContext } | undefined;
    function TestComponent() {
      result = useFeatureHub();
      return null;
    }

    render(
      <Wrapper>
        <TestComponent />
      </Wrapper>,
    );

    expect(result!.config).toBeDefined();
    expect(result!.client).toBeDefined();
  });

  it("throws when not configured and outside FeatureHub wrapper", () => {
    // Suppress React's error boundary output
    vi.spyOn(console, "error").mockImplementation(() => {});

    function TestComponent() {
      useFeatureHub();
      return null;
    }

    expect(() => render(<TestComponent />)).toThrow(
      "Cannot get FeatureHub client inside of component not wrapped by the <FeatureHub> component!",
    );
  });
});

// ---------------------------------------------------------------------------
// useFeatureHubClient (deprecated)
// ---------------------------------------------------------------------------

describe("useFeatureHubClient", () => {
  afterEach(() => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);
    vi.clearAllMocks();
  });

  it("returns the global ClientContext when configured", () => {
    const { mockConfig, mockContext } = buildBaseMocks();
    fhStatic.set(mockConfig, mockContext);

    let result: ClientContext | undefined;
    function TestComponent() {
      result = useFeatureHubClient();
      return null;
    }

    render(<TestComponent />);
    expect(result).toBe(mockContext);
  });

  it("throws when not configured", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    function TestComponent() {
      useFeatureHubClient();
      return null;
    }

    expect(() => render(<TestComponent />)).toThrow(
      "Cannot get FeatureHub client inside of component not wrapped by the <FeatureHub> component!",
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
  let capturedFeatureListener: ((fsh: FeatureStateHolder) => void) | undefined;

  beforeEach(() => {
    capturedFeatureListener = undefined;

    mockFeatureHolder = {
      value: undefined as unknown,
      addListener: vi.fn().mockImplementation((listener: (fsh: FeatureStateHolder) => void) => {
        capturedFeatureListener = listener;
        return 1;
      }),
      removeListener: vi.fn(),
      isSet: vi.fn().mockReturnValue(false),
    };

    const { mockConfig, mockContext } = buildBaseMocks();
    (mockContext.feature as ReturnType<typeof vi.fn>).mockReturnValue(mockFeatureHolder);
    fhStatic.set(mockConfig, mockContext);
  });

  afterEach(() => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);
    vi.clearAllMocks();
  });

  function renderFeature<T>(key: string) {
    function TestComponent() {
      const value = useFeature<T>(key);
      return <div data-testid="value">{String(value)}</div>;
    }
    return render(
      <Wrapper>
        <TestComponent />
      </Wrapper>,
    );
  }

  it("returns undefined when the feature has no value", () => {
    renderFeature("my_flag");
    expect(screen.getByTestId("value")).toHaveTextContent("undefined");
  });

  it("returns the initial value immediately when isSet() is true", () => {
    mockFeatureHolder.value = true;
    mockFeatureHolder.isSet.mockReturnValue(true);

    renderFeature<boolean>("my_flag");

    expect(screen.getByTestId("value")).toHaveTextContent("true");
  });

  it("updates the displayed value when the feature listener fires", () => {
    // value starts as undefined (beforeEach default)

    renderFeature<boolean>("my_flag");
    expect(screen.getByTestId("value")).toHaveTextContent("undefined");

    act(() => {
      mockFeatureHolder.value = true;
      capturedFeatureListener?.(mockFeatureHolder as unknown as FeatureStateHolder);
    });

    expect(screen.getByTestId("value")).toHaveTextContent("true");
  });

  it("registers a listener for the requested feature key on mount", () => {
    function TestComponent() {
      useFeature("feature_x");
      return null;
    }
    render(
      <Wrapper>
        <TestComponent />
      </Wrapper>,
    );

    const featureFn = fhStatic.context.feature as ReturnType<typeof vi.fn>;
    expect(featureFn).toHaveBeenCalledWith("feature_x");
    expect(mockFeatureHolder.addListener).toHaveBeenCalledOnce();
  });

  it("removes the feature listener on unmount", () => {
    function TestComponent() {
      useFeature("my_flag");
      return null;
    }
    const { unmount } = render(
      <Wrapper>
        <TestComponent />
      </Wrapper>,
    );

    unmount();

    expect(mockFeatureHolder.removeListener).toHaveBeenCalledWith(1);
  });
});
