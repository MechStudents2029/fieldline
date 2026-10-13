import { sumCounting, type PricedLine } from "@/lib/estimate/pricing";
import { taxCents } from "@/lib/money";

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const DEFAULT_OPTION_NAMES = ["Good", "Better", "Best", "Premium"] as const;

export type OptionStatus = "open" | "chosen" | "declined";

export function assertOptionBand(count: number) {
  if (!Number.isInteger(count) || count < MIN_OPTIONS || count > MAX_OPTIONS) {
    throw new Error("An estimate can have 2 to 4 options.");
  }
}

export function optionName(name: string): string {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) throw new Error("Name the option.");
  return trimmed;
}

export function nextOptionName(existing: string[]): string {
  const used = new Set(existing.map((name) => name.toLowerCase()));
  return DEFAULT_OPTION_NAMES.find((name) => !used.has(name.toLowerCase())) ?? `Option ${existing.length + 1}`;
}

/** One recommended flag, or none. */
export function withRecommended<T extends { id: string; recommended: boolean }>(options: T[], id: string | null): T[] {
  return options.map((option) => ({ ...option, recommended: id != null && option.id === id }));
}

export function optionTotals(lines: PricedLine[], taxBps: number, depositBps: number) {
  const sums = sumCounting(lines);
  const tax = taxCents(sums.priceCents, taxBps);
  const totalCents = sums.priceCents + tax;
  const deposit = Math.round((totalCents * depositBps) / 10000);
  return {
    costCents: sums.costCents,
    priceCents: sums.priceCents,
    taxCents: tax,
    totalCents,
    marginBps: sums.marginBps,
    depositCents: deposit,
  };
}

export function gateOption<T extends { recommended: boolean }>(options: T[]): T {
  if (options.length === 0) throw new Error("This estimate has no options.");
  return options.find((option) => option.recommended) ?? options[0];
}

type PricedStatus<T> = Omit<T, "status"> & { status: OptionStatus };

/** Client picks one. The others become declined. A second pick is refused. */
export function chooseOption<T extends { id: string; status: OptionStatus }>(options: T[], optionId: string): PricedStatus<T>[] {
  if (options.length < MIN_OPTIONS) throw new Error("This proposal has no options.");
  if (!options.some((option) => option.id === optionId)) throw new Error("That option is not on this proposal.");
  if (options.some((option) => option.status === "chosen")) throw new Error("An option is already chosen.");
  return options.map((option) => ({ ...option, status: option.id === optionId ? "chosen" : "declined" }));
}

/** Office sets the chosen option. Refused once a deposit has been paid. */
export function assignOption<T extends { id: string; status: OptionStatus }>(
  options: T[],
  optionId: string,
  input: { depositPaidCents: number; reason: string },
): PricedStatus<T>[] {
  if (options.length < MIN_OPTIONS) throw new Error("This proposal has no options.");
  if (!options.some((option) => option.id === optionId)) throw new Error("That option is not on this proposal.");
  if (!Number.isSafeInteger(input.depositPaidCents) || input.depositPaidCents < 0) throw new Error("Check the deposit.");
  if (input.depositPaidCents > 0) throw new Error("A deposit is already paid.");
  if (input.reason.trim().length < 2) throw new Error("Add a reason.");
  return options.map((option) => ({ ...option, status: option.id === optionId ? "chosen" : "declined" }));
}

export type OptionProposalRow = {
  id: string;
  status: string;
  totalCents: number;
  href: string;
  options: { name: string; status: string }[] | null;
};

export type OptionFigure = {
  id: string;
  href: string;
  set: string;
  wins: number | null;
  winsInTotal: boolean;
  shareBps: number | null;
  amountCents: number | null;
  amountInTotal: boolean;
};

export function optionFigures(rows: OptionProposalRow[]): OptionFigure[] {
  const signed = rows.filter((row) => row.status === "signed");
  const withOptions = signed.filter((row) => (row.options?.length ?? 0) >= MIN_OPTIONS);
  const without = signed.filter((row) => (row.options?.length ?? 0) < MIN_OPTIONS);
  const names: string[] = [];
  for (const row of withOptions) {
    for (const option of row.options ?? []) {
      if (!names.includes(option.name)) names.push(option.name);
    }
  }
  const chosen = withOptions.flatMap((row) => (row.options ?? []).filter((option) => option.status === "chosen"));
  const totalWins = chosen.length;
  const figures: OptionFigure[] = names.map((name) => {
    const wins = chosen.filter((option) => option.name === name).length;
    const amount = withOptions
      .filter((row) => (row.options ?? []).some((option) => option.name === name && option.status === "chosen"))
      .reduce((sum, row) => sum + row.totalCents, 0);
    return {
      id: `win:${name}`,
      href: "",
      set: name,
      wins,
      winsInTotal: true,
      shareBps: totalWins === 0 ? 0 : Math.round((wins * 10_000) / totalWins),
      amountCents: amount,
      amountInTotal: true,
    };
  });
  const average = (list: OptionProposalRow[]) => (list.length === 0 ? null : Math.round(list.reduce((sum, row) => sum + row.totalCents, 0) / list.length));
  figures.push({
    id: "avg:with",
    href: "",
    set: "With options",
    wins: withOptions.length,
    winsInTotal: false,
    shareBps: null,
    amountCents: average(withOptions),
    amountInTotal: false,
  });
  figures.push({
    id: "avg:without",
    href: "",
    set: "Without options",
    wins: without.length,
    winsInTotal: false,
    shareBps: null,
    amountCents: average(without),
    amountInTotal: false,
  });
  return figures;
}
