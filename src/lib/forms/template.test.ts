import { describe, expect, it } from "vitest";
import { checkAnswers, normalizeTemplate } from "@/lib/forms/template";

const walk = {
  title: "Site walkthrough",
  description: "Photos and notes.",
  audiences: ["office", "field"],
  fields: [
    { label: "Photo", type: "photo", required: true },
    { label: "Site is safe", type: "checkbox", required: true },
    { label: "Notes", type: "text", required: false },
  ],
};

describe("form templates", () => {
  it("keeps field ids and requires select options", () => {
    const first = normalizeTemplate(walk);
    expect(first.fields.map((field) => field.id)).toEqual(["photo", "site_is_safe", "notes"]);
    const again = normalizeTemplate(
      {
        ...walk,
        fields: first.fields.map((field) => ({ ...field, label: field.label === "Notes" ? "Site notes" : field.label })),
      },
      first.fields.map((field) => field.id),
    );
    expect(again.fields.find((field) => field.label === "Site notes")?.id).toBe("notes");
    expect(() =>
      normalizeTemplate({
        title: "Vendor",
        description: "",
        audiences: ["vendor"],
        fields: [{ label: "Trade", type: "select", required: true, options: [] }],
      }),
    ).toThrow(/Add options/);
    expect(() => normalizeTemplate({ ...walk, audiences: [] })).toThrow(/who can fill/);
    expect(() => normalizeTemplate({ ...walk, fields: [] })).toThrow(/Add a field/);
  });

  it("checks required answers, dates, and numbers", () => {
    const fields = normalizeTemplate({
      title: "PTO",
      description: "",
      audiences: ["field"],
      fields: [
        { label: "Start", type: "date", required: true },
        { label: "Days", type: "number", required: true },
        { label: "Reason", type: "text", required: true },
        { label: "Trade", type: "select", required: true, options: ["Electrical"] },
        { label: "Photo", type: "photo", required: true },
      ],
    }).fields;
    const byId = Object.fromEntries(fields.map((field) => [field.label, field.id]));
    expect(() => checkAnswers(fields, {})).toThrow(/Add Start/);
    expect(() => checkAnswers(fields, { [byId.Start]: { text: "10/16/2026" } })).toThrow(/needs a date/);
    expect(() =>
      checkAnswers(fields, {
        [byId.Start]: { text: "2026-10-16" },
        [byId.Days]: { text: "two" },
      }),
    ).toThrow(/needs a number/);
    expect(() =>
      checkAnswers(fields, {
        [byId.Start]: { text: "2026-10-16" },
        [byId.Days]: { text: "2" },
        [byId.Reason]: { text: "Travel" },
        [byId.Trade]: { text: "Plumbing" },
      }),
    ).toThrow(/Choose Trade/);
    const answers = checkAnswers(fields, {
      [byId.Start]: { text: "2026-10-16" },
      [byId.Days]: { text: "2" },
      [byId.Reason]: { text: "Travel" },
      [byId.Trade]: { text: "Electrical" },
      [byId.Photo]: { hasFile: true },
    });
    expect(answers.find((row) => row.fieldId === byId.Photo)?.needsFile).toBe(true);
    expect(answers.find((row) => row.fieldId === byId.Days)?.text).toBe("2");
  });
});
