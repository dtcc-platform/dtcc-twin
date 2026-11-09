// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Composer } from "./composer";
afterEach(cleanup);
it("disables Send during a turn", () => {
  render(createElement(Composer, { answering: true, area: null, onSend: vi.fn() }));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send" }).disabled).toBe(true);
});
it("warns when the selected area exceeds the limit", () => {
  render(
    createElement(Composer, {
      answering: false,
      area: { west: 11.9, south: 57.6, east: 12, north: 57.7 },
      onSend: vi.fn(),
    }),
  );
  expect(screen.getByRole("alert").textContent).toMatch(/5 km²/);
});
it("restores the question and shows a failed send", async () => {
  const send = vi.fn().mockRejectedValue(new Error("Connection lost"));
  render(createElement(Composer, { answering: false, area: null, onSend: send }));
  await userEvent.type(screen.getByRole<HTMLInputElement>("textbox", { name: "Question" }), "How many buildings?");
  fireEvent.submit(
    screen.getByRole<HTMLButtonElement>("button", { name: "Send" }).closest("form") ??
      (() => {
        throw new Error("Missing form");
      })(),
  );
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Connection lost"));
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Question" }).value).toBe("How many buildings?");
});
