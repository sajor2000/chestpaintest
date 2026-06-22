import { describe, expect, it } from "vitest";

import {
  evaluateApiFaithfulness,
  evaluateBrowserFaithfulness,
} from "../../scripts/clinician-pathway-faithfulness.mjs";

describe("clinician pathway faithfulness audit helpers", () => {
  it("fails terminal states that still expose pathway quick replies", () => {
    const result = evaluateApiFaithfulness(
      {
        requiredField: null,
        terminal: true,
        allowedOptions: ["Male"],
        values: {},
        results: [{ kind: "determine_disposition", data: { risk: "LOW" } }],
      },
      { terminal: true, risk: "LOW" },
      "terminal low-risk case"
    );

    expect(result.status).toBe("FAIL");
    expect(result.concerns.join(" ")).toMatch(/terminal.*allowedOptions/i);
  });

  it("requires exact allowed options for the current server-selected field", () => {
    const result = evaluateApiFaithfulness(
      {
        requiredField: "isEsrd",
        terminal: false,
        allowedOptions: ["Yes - ESRD"],
        values: { sex: "male" },
        results: [],
      },
      {
        requiredField: "isEsrd",
        terminal: false,
        allowedOptions: ["Yes - ESRD", "No ESRD"],
      },
      "ESRD step"
    );

    expect(result.status).toBe("FAIL");
    expect(result.concerns.join(" ")).toMatch(/allowedOptions/i);
  });

  it("passes when browser quick replies match the controller allowed options", () => {
    const result = evaluateBrowserFaithfulness(
      {
        status: "PASS",
        quickReplyButtons: ["Male", "Female"],
        latestControllerState: {
          requiredField: "sex",
          question: "Patient sex?",
          terminal: false,
          allowedOptions: ["Male", "Female"],
          values: {},
          results: [],
        },
      },
      {
        requiredField: "sex",
        question: "Patient sex?",
        terminal: false,
        allowedOptions: ["Male", "Female"],
        values: {},
        results: [],
      },
      { requiredField: "sex", terminal: false, allowedOptions: ["Male", "Female"] },
      "browser sex step"
    );

    expect(result.status).toBe("PASS");
  });

  it("fails browser runs that show stale quick replies after controller state changes", () => {
    const result = evaluateBrowserFaithfulness(
      {
        status: "PASS",
        quickReplyButtons: ["Yes - ESRD", "No ESRD"],
        latestControllerState: {
          requiredField: "symptomDurationHours",
          question: "What is the duration of symptoms in hours?",
          terminal: false,
          allowedOptions: [],
          values: { sex: "male", isEsrd: false },
          results: [],
        },
      },
      {
        requiredField: "symptomDurationHours",
        question: "What is the duration of symptoms in hours?",
        terminal: false,
        allowedOptions: [],
        values: { sex: "male", isEsrd: false },
        results: [],
      },
      { requiredField: "symptomDurationHours", terminal: false, allowedOptions: [] },
      "browser duration step"
    );

    expect(result.status).toBe("FAIL");
    expect(result.concerns.join(" ")).toMatch(/quick replies/i);
  });
});
