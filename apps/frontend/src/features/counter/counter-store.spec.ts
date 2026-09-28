import { describe, expect, it } from "vitest";
import { createCounterStore } from "./counter-store.ts";

describe("createCounterStore", () => {
  it("starts at the initial count", () => {
    const store = createCounterStore(5);

    expect(store.getState().count).toBe(5);
  });

  it("increments and decrements by one", () => {
    const store = createCounterStore(0);
    const { increment, decrement } = store.getState().actions;

    increment();
    increment();
    decrement();

    expect(store.getState().count).toBe(1);
  });

  it("resets to its own initial count", () => {
    const store = createCounterStore(10);
    const { increment, reset } = store.getState().actions;

    increment();
    reset();

    expect(store.getState().count).toBe(10);
  });

  it("keeps each store independent", () => {
    const first = createCounterStore(0);
    const second = createCounterStore(0);

    first.getState().actions.increment();

    expect(first.getState().count).toBe(1);
    expect(second.getState().count).toBe(0);
  });
});
