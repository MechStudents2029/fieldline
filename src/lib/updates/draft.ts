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
    thisWeek.push({ text: sentence(`${item.title} finished ${formatCalendarDay(item.endDate)}`), source: { kind: "schedule", id: item.id } });
  }
  for (const item of started) {
    thisWeek.push({ text: sentence(`${item.title} started ${formatCalendarDay(item.startDate)}`), source: { kind: "schedule", id: item.id } });
  }
  for (const item of upcoming) {
    nextWeek.push({ text: sentence(`${item.title} is set for ${formatCalendarDay(item.startDate)}`), source: { kind: "schedule", id: item.id } });
  }

  const decisions: DraftSentence[] = selections.map((item) => ({
    text: sentence(`${item.title} is due ${formatCalendarDay(item.dueDate)}`),
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
