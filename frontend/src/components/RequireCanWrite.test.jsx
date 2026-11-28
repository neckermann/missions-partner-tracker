import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RequireCanWrite from "./RequireCanWrite.jsx";

let current;
vi.mock("../hooks/useCurrentUser.js", () => ({ default: () => current }));

const show = () =>
  render(
    <MemoryRouter initialEntries={["/admin/partners/new"]}>
      <Routes>
        <Route path="/admin/partners" element={<p>The list</p>} />
        <Route
          path="/admin/partners/new"
          element={
            <RequireCanWrite>
              <p>The form</p>
            </RequireCanWrite>
          }
        />
      </Routes>
    </MemoryRouter>
  );

describe("RequireCanWrite", () => {
  it("shows the page to an admin or editor", () => {
    current = { loading: false, canWrite: true };
    show();
    expect(screen.getByText("The form")).toBeTruthy();
  });
  it("sends a viewer or guest back to the list", () => {
    current = { loading: false, canWrite: false };
    show();
    expect(screen.getByText("The list")).toBeTruthy();
    expect(screen.queryByText("The form")).toBeNull();
  });
  it("shows nothing while the person is still loading", () => {
    current = { loading: true, canWrite: false };
    show();
    expect(screen.queryByText("The form")).toBeNull();
    expect(screen.queryByText("The list")).toBeNull();
  });
});
