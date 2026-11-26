import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NeedDecisionFields from "./NeedDecisionFields.jsx";
import { formatRequestedAmount } from "../../utils/format.js";

// Record Decision has a real Decline choice, so nobody has to know that $0 means no.
function Harness({ onChange }) {
  const [decision, setDecision] = useState({ approvedAmount: "", approvedDate: "", decisionNote: "" });
  onChange(decision);
  return <NeedDecisionFields decision={decision} setDecision={setDecision} />;
}

describe("NeedDecisionFields", () => {
  it("Decline sets the approved amount to 0 and locks the amount box; unticking frees it", () => {
    let latest;
    render(<Harness onChange={(d) => (latest = d)} />);
    const amount = screen.getByLabelText("Approved Amount ($)");
    expect(amount.disabled).toBe(false);
    fireEvent.click(screen.getByLabelText(/Decline this request/));
    expect(latest.approvedAmount).toBe("0");
    expect(screen.getByLabelText("Approved Amount ($)").disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Decline this request/));
    expect(latest.approvedAmount).toBe("");
    expect(screen.getByLabelText("Approved Amount ($)").disabled).toBe(false);
  });

  it("typing an amount is a normal approval", () => {
    let latest;
    render(<Harness onChange={(d) => (latest = d)} />);
    fireEvent.change(screen.getByLabelText("Approved Amount ($)"), { target: { value: "300" } });
    expect(latest.approvedAmount).toBe("300");
    expect(screen.getByLabelText(/Decline this request/).checked).toBe(false);
  });

  it("a note can be added either way", () => {
    let latest;
    render(<Harness onChange={(d) => (latest = d)} />);
    fireEvent.change(screen.getByLabelText(/Decision Note/), { target: { value: "Not this year" } });
    expect(latest.decisionNote).toBe("Not this year");
  });
});

describe("formatRequestedAmount", () => {
  it("shows a dollar figure, or says there is none", () => {
    expect(formatRequestedAmount(1500)).toMatch(/1,500/);
    expect(formatRequestedAmount(0)).toBe("No amount");
    expect(formatRequestedAmount(null)).toBe("No amount");
  });
});
