import { formatCalendarDay } from "@/lib/format";
import { formatMoney } from "@/lib/money";

export const UPDATE_PHOTO_CAP = 6;

export const UPDATE_SECTION_KEYS = ["this_week", "next_week", "decisions", "money", "photos"] as const;

export type UpdateSectionKey = (typeof UPDATE_SECTION_KEYS)[number];

export type SourceKind = "log" | "schedule" | "change_order" | "invoice" | "selection" | "photo";

export type SourceRef = { kind: SourceKind; id: string };

export type DraftSentence = { text: string; source: SourceRef | null };

export type DraftSection = { key: UpdateSectionKey; title: string; sentences: DraftSentence[] };

export type ClientUpdateDraft = { sections: DraftSection[]; photoIds: string[] };

export type ClientUpdateFacts = {
  logs: {
    id: string;
    logDate: string;
    notes: string | null;
    plannedNext: string | null;
    weatherSky: string | null;
    weatherHighF: number | null;
    weatherLowF: number | null;
    photos: { id: string; caption: string }[];
  }[];
  completed: { id: string; title: string; endDate: string }[];
  started: { id: string; title: string; startDate: string }[];
  upcoming: { id: string; title: string; startDate: string }[];
  changeOrders: { id: string; number: number; title: string; status: "approved" | "sent"; priceDeltaCents: number }[];
  invoices: { id: string; number: string; status: "sent" | "paid"; totalCents: number }[];
  selections: { id: string; title: string; dueDate: string }[];
  asOf: string;
};

const TITLES: Record<UpdateSectionKey, string> = {
  this_week: "This week",
  next_week: "Next week",
  decisions: "Decisions needed",
  money: "Money",
  photos: "Photos",
};

function byText(left: string, right: string): number {
  return left.localeCompare(right);
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function weatherLine(log: ClientUpdateFacts["logs"][number]): string {
  const sky = log.weatherSky?.trim() || "";
  const temps = log.weatherHighF != null && log.weatherLowF != null ? `${log.weatherHighF}°/${log.weatherLowF}°` : "";
  return sentence([sky, temps].filter(Boolean).join(", "));
}

function lowerFirst(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "the work";
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function startedLine(title: string, day: string): string {
  const when = formatCalendarDay(day);
  if (/walk/i.test(title)) return sentence(`We walked the job with you on ${when}`);
  if (/^(set|install|hang|frame|paint|grout)\b/i.test(title)) return sentence(`We ${lowerFirst(title)} on ${when}`);
  return sentence(`We started the ${lowerFirst(title)} on ${when}`);
}

function finishedLine(title: string, day: string): string {
  return sentence(`We finished ${lowerFirst(title)} on ${formatCalendarDay(day)}`);
}

function upcomingLine(title: string, day: string): string {
  const when = formatCalendarDay(day);
  if (/walk/i.test(title)) return sentence(`We'll walk the job with you on ${when}`);
  return sentence(`We'll start the ${lowerFirst(title)} on ${when}`);
}

function decisionLine(title: string, due: string, asOf: string): string {
  const when = formatCalendarDay(due);
  const pick = /pick\b/i.test(title) ? lowerFirst(title) : `${lowerFirst(title)} pick`;
  if (due < asOf) return sentence(`We still need your ${pick} (was due ${when})`);
  return sentence(`We need your ${pick} by ${when}`);
}

function section(key: UpdateSectionKey, sentences: DraftSentence[]): DraftSection {
  const kept = sentences.filter((row) => row.text);
  return {
    key,
    title: TITLES[key],
    sentences: kept.length > 0 ? kept : [{ text: "Nothing to report.", source: null }],
  };
}

/** Deterministic client update. Every sentence points at the record it came from. */
export function draftClientUpdate(facts: ClientUpdateFacts): ClientUpdateDraft {
  const logs = [...facts.logs].sort((a, b) => byText(a.logDate, b.logDate) || byText(a.id, b.id));
  const completed = [...facts.completed].sort((a, b) => byText(a.endDate, b.endDate) || byText(a.title, b.title) || byText(a.id, b.id));
  const started = [...facts.started].sort((a, b) => byText(a.startDate, b.startDate) || byText(a.title, b.title) || byText(a.id, b.id));
  const upcoming = [...facts.upcoming].sort((a, b) => byText(a.startDate, b.startDate) || byText(a.title, b.title) || byText(a.id, b.id));
  const orders = [...facts.changeOrders].sort((a, b) => a.number - b.number || byText(a.id, b.id));
  const invoices = [...facts.invoices].sort((a, b) => byText(a.number, b.number) || byText(a.id, b.id));
  const selections = [...facts.selections].sort((a, b) => byText(a.dueDate, b.dueDate) || byText(a.title, b.title) || byText(a.id, b.id));

  const thisWeek: DraftSentence[] = [];
  const nextWeek: DraftSentence[] = [];
  const photos: { id: string; caption: string; logId: string }[] = [];
  for (const log of logs) {
    const note = sentence(log.notes || "");
    if (note) thisWeek.push({ text: note, source: { kind: "log", id: log.id } });
    const weather = weatherLine(log);
    if (weather) thisWeek.push({ text: weather, source: { kind: "log", id: log.id } });
    const next = sentence(log.plannedNext || "");
    if (next) nextWeek.push({ text: next, source: { kind: "log", id: log.id } });
    for (const photo of log.photos) {
      photos.push({ id: photo.id, caption: photo.caption, logId: log.id });
    }
  }
  for (const item of completed) {
    thisWeek.push({ text: finishedLine(item.title, item.endDate), source: { kind: "schedule", id: item.id } });
  }
  for (const item of started) {
    thisWeek.push({ text: startedLine(item.title, item.startDate), source: { kind: "schedule", id: item.id } });
  }
  for (const item of upcoming) {
    nextWeek.push({ text: upcomingLine(item.title, item.startDate), source: { kind: "schedule", id: item.id } });
  }

  const decisions: DraftSentence[] = selections.map((item) => ({
    text: decisionLine(item.title, item.dueDate, facts.asOf),
    source: { kind: "selection", id: item.id },
  }));

  const money: DraftSentence[] = [
    ...orders.map((order) => ({
      text: sentence(`Change order ${order.number}, ${order.title}, ${formatMoney(order.priceDeltaCents)}, is ${order.status === "approved" ? "approved" : "pending"}`),
      source: { kind: "change_order" as const, id: order.id },
    })),
    ...invoices.map((invoice) => ({
      text: sentence(`Invoice ${invoice.number}, ${formatMoney(invoice.totalCents)}, was ${invoice.status === "paid" ? "paid" : "sent"}`),
      source: { kind: "invoice" as const, id: invoice.id },
    })),
  ];

  const picked = photos.slice(0, UPDATE_PHOTO_CAP);
  const photoSentences: DraftSentence[] = picked.map((photo) => ({
    text: sentence(photo.caption || "Photo"),
    source: { kind: "photo", id: photo.id },
  }));

  return {
    sections: [
      section("this_week", thisWeek),
      section("next_week", nextWeek),
      section("decisions", decisions),
      section("money", money),
      section("photos", photoSentences),
    ],
    photoIds: picked.map((photo) => photo.id),
  };
}

export function renderUpdateBody(draft: ClientUpdateDraft): string {
  return draft.sections.map((part) => `${part.title}\n${part.sentences.map((row) => row.text).join("\n")}`).join("\n\n");
}

export function sectionTitle(key: UpdateSectionKey): string {
  return TITLES[key];
}

export function splitUpdateBody(body: string): Record<UpdateSectionKey, string> {
  const parts = Object.fromEntries(UPDATE_SECTION_KEYS.map((key) => [key, ""])) as Record<UpdateSectionKey, string>;
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let current: UpdateSectionKey | null = null;
  const bucket: string[] = [];
  const flush = () => {
    if (!current) return;
    parts[current] = bucket.join("\n").trim();
    bucket.length = 0;
  };
  for (const line of lines) {
    const key = UPDATE_SECTION_KEYS.find((item) => TITLES[item] === line.trim());
    if (key) {
      flush();
      current = key;
      continue;
    }
    if (current) bucket.push(line);
  }
  flush();
  if (!UPDATE_SECTION_KEYS.some((key) => parts[key])) parts.this_week = body.trim();
  return parts;
}

export function joinUpdateSections(parts: Record<UpdateSectionKey, string>): string {
  return UPDATE_SECTION_KEYS.map((key) => `${TITLES[key]}\n${parts[key].trim() || "Nothing to report."}`).join("\n\n");
}
