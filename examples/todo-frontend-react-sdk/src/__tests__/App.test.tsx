import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks ----------------------------------------------------------------

const mockBuild = vi.fn();
const mockUserKey = vi.fn().mockReturnValue({ build: mockBuild });
const mockFhContext = {
  feature: vi.fn(),
  userKey: mockUserKey,
  build: mockBuild,
};

// Mutable values that tests can override to simulate feature flag state
let uppercaseTextValue: boolean | undefined = false;
let textColourValue: string | undefined = undefined;

vi.mock("featurehub-react-sdk", () => ({
  FeatureHub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFeatureHub: () => ({ client: mockFhContext }),
  useFeature: (key: string) => {
    if (key === "uppercase_text") return uppercaseTextValue;
    if (key === "text_colour") return textColourValue;
    return undefined;
  },
}));

// --------------------------------------------------------------------------

import React from "react";

// App must be imported AFTER the mock is set up
const { default: App } = await import("../App");

const SAMPLE_TEXT =
  "This is some random text content which may have its case-sensitivity modified.";

describe("App", () => {
  beforeEach(() => {
    uppercaseTextValue = false;
    textColourValue = undefined;
    mockUserKey.mockClear();
    mockBuild.mockClear();
  });

  describe("Main — counter", () => {
    it("shows count starting at 0", () => {
      render(<App />);
      expect(screen.getByRole("button", { name: /count: 0/i })).toBeInTheDocument();
    });

    it("increments counter on each click", async () => {
      const user = userEvent.setup();
      render(<App />);

      const btn = screen.getByRole("button", { name: /count:/i });
      await user.click(btn);
      expect(screen.getByRole("button", { name: /count: 1/i })).toBeInTheDocument();

      await user.click(btn);
      expect(screen.getByRole("button", { name: /count: 2/i })).toBeInTheDocument();
    });
  });

  describe("Main — change user key", () => {
    it("calls userKey and build when 'Change user key' is clicked", async () => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(screen.getByRole("button", { name: /change user key/i }));

      expect(mockUserKey).toHaveBeenCalledOnce();
      // userKey is called with a random string — just verify it received a string argument
      expect(typeof mockUserKey.mock.calls[0]![0]).toBe("string");
      expect(mockBuild).toHaveBeenCalledOnce();
    });
  });

  describe("Main — uppercase_text feature", () => {
    it("displays normal-case text when uppercase_text is false", () => {
      uppercaseTextValue = false;
      render(<App />);
      expect(screen.getByText(SAMPLE_TEXT)).toBeInTheDocument();
    });

    it("displays upper-case text when uppercase_text is true", () => {
      uppercaseTextValue = true;
      render(<App />);
      expect(screen.getByText(SAMPLE_TEXT.toUpperCase())).toBeInTheDocument();
    });

    it("shows the feature value in the UI", () => {
      uppercaseTextValue = true;
      render(<App />);
      expect(screen.getByText("true")).toBeInTheDocument();
    });
  });

  describe("Main — text_colour feature", () => {
    it("renders empty colour display when text_colour is not set", () => {
      textColourValue = undefined;
      render(<App />);
      // When colour is undefined the paragraph ends with no colour word
      const para = screen.getByText(
        (_, el) =>
          el?.tagName === "P" && el.textContent?.trim() === "This paragraph color should be",
      );
      expect(para).toBeInTheDocument();
    });

    it("applies the colour to the styled paragraph", () => {
      textColourValue = "red";
      render(<App />);

      const colourParagraph = screen.getByText(/this paragraph color should be/i);
      // jsdom resolves named colors to rgb values
      expect(colourParagraph).toHaveStyle({ color: "rgb(255, 0, 0)" });
    });

    it("shows the colour name in the paragraph text", () => {
      textColourValue = "blue";
      render(<App />);
      expect(screen.getByText(/this paragraph color should be blue/i)).toBeInTheDocument();
    });
  });
});
