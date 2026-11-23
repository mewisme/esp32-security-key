import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChangedSinceMount } from "@/hooks/useChangedSinceMount";

describe("useChangedSinceMount", () => {
  it("is false for the value a view opened with, so its content rides on the view's own entrance", () => {
    const { result, rerender } = renderHook(({ value }) => useChangedSinceMount(value), { initialProps: { value: "ready" } });
    expect(result.current).toBe(false);
    rerender({ value: "ready" });
    expect(result.current).toBe(false);
  });

  it("turns true when the value changes (a load finishing, a result arriving) and stays true", () => {
    const { result, rerender } = renderHook(({ value }) => useChangedSinceMount(value), { initialProps: { value: "loading" } });
    rerender({ value: "ready" });
    expect(result.current).toBe(true);
    rerender({ value: "loading" });
    expect(result.current).toBe(true);
  });
});
