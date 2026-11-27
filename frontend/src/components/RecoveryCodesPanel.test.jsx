import React from "react";
import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecoveryCodesPanel from "./RecoveryCodesPanel.jsx";

describe("RecoveryCodesPanel", () => {
  test("lists every code and keeps the way on closed until they are saved", () => {
    const onDone = vi.fn();
    render(<RecoveryCodesPanel codes={["aaaaa-bbbbb", "ccccc-ddddd"]} onDone={onDone} />);
    expect(screen.getByText("aaaaa-bbbbb")).toBeInTheDocument();
    expect(screen.getByText("ccccc-ddddd")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Continue" });
    expect(next).toBeDisabled();
    fireEvent.click(next);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/I have saved these codes/));
    fireEvent.click(next);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test("says the codes are not shown again and offers a download", () => {
    render(<RecoveryCodesPanel codes={["aaaaa-bbbbb"]} onDone={() => {}} />);
    expect(screen.getByText(/They are not shown again/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download as a text file" })).toBeInTheDocument();
  });
});
