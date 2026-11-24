import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Wizard from "./Wizard.jsx";

const steps = [
  {
    key: "one",
    label: "Step One",
    render: ({ values, setValue }) => (
      <input aria-label="name" value={values.name || ""} onChange={(e) => setValue("name", e.target.value)} />
    ),
    validate: (values) => (values.name ? null : "Name is required"),
  },
  {
    key: "two",
    label: "Step Two",
    render: () => <div>Second step content</div>,
    optional: true,
  },
];

describe("Wizard", () => {
  it("renders the first step initially", () => {
    render(<Wizard steps={steps} onFinish={() => {}} />);
    expect(screen.getByLabelText("name")).toBeInTheDocument();
    expect(screen.queryByText("Second step content")).not.toBeInTheDocument();
  });

  it("blocks Next with the step's validation error", () => {
    render(<Wizard steps={steps} onFinish={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
    expect(screen.queryByText("Second step content")).not.toBeInTheDocument();
  });

  it("advances to the next step once validation passes", () => {
    render(<Wizard steps={steps} onFinish={() => {}} />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Second step content")).toBeInTheDocument();
  });

  it("calls onFinish with collected values on the last step", () => {
    const onFinish = vi.fn();
    render(<Wizard steps={steps} onFinish={onFinish} />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onFinish).toHaveBeenCalledWith({ name: "Alice" });
  });

  it("Skip on an optional step advances without validation", () => {
    render(<Wizard steps={steps} onFinish={() => {}} />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  it("leaves out a step whose show() is false for the current values", () => {
    const conditional = [
      { ...steps[0], validate: undefined },
      { key: "extra", label: "Extra", render: () => <div>Extra content</div>, show: (v) => v.name === "yes" },
      { key: "last", label: "Last", render: () => <div>Last content</div> },
    ];
    render(<Wizard steps={conditional} onFinish={() => {}} />);
    expect(screen.queryByText(/Extra$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Last content")).toBeInTheDocument();
  });
});
