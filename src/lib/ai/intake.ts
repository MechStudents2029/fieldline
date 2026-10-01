export type Intake = {
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  sqft: number | null;
  valueLowCents: number | null;
  valueHighCents: number | null;
  projectType: string;
  scope: string;
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/;
const SQFT = /(\d{2,5})\s*(?:sq\.?\s*ft|square feet|sqft|sf)\b/i;
const VALUE_RANGE = /\$\s*(\d{1,3})(?:\s*[kK])?\s*[–—-]\s*\$?\s*(\d{1,3})\s*[kK]/;
const VALUE_SINGLE = /\$\s*(\d{2,3})\s*[kK]\b/;
const ADDRESS = /\b(\d{1,6}\s+[A-Za-z0-9.'\- ]+?(?:Ave|Avenue|St|Street|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Way|Ct|Court)\.?)\b/;

function titleCaseName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function extractIntake(text: string): Intake {
  const trimmed = text.trim();
  const email = trimmed.match(EMAIL)?.[0] ?? null;
  const phone = trimmed.match(PHONE)?.[0] ?? null;
  const sqft = trimmed.match(SQFT)?.[1] ? Number(trimmed.match(SQFT)![1]) : null;
  const address = trimmed.match(ADDRESS)?.[1]?.replace(/\s+/g, " ") ?? null;

  let valueLowCents: number | null = null;
  let valueHighCents: number | null = null;
  const range = trimmed.match(VALUE_RANGE);
  if (range) {
    valueLowCents = Number(range[1]) * 100_000;
    valueHighCents = Number(range[2]) * 100_000;
  } else {
    const single = trimmed.match(VALUE_SINGLE);
    if (single) {
      valueLowCents = Number(single[1]) * 100_000;
      valueHighCents = valueLowCents;
    }
  }

  let name: string | null = null;
  const firstChunk = trimmed.split(/[\n.]/)[0] ?? trimmed;
  const beforeComma = firstChunk.split(",")[0]?.trim() ?? "";
  if (beforeComma && !/\$|\d{3}/.test(beforeComma) && beforeComma.split(" ").length <= 4) {
    const cleaned = beforeComma.replace(/^(lead|client|homeowner)\s*:\s*/i, "");
    if (/[A-Za-z]/.test(cleaned) && cleaned.length < 48) name = titleCaseName(cleaned);
  }

  const lower = trimmed.toLowerCase();
  let projectType = "Remodel";
  if (/kitchen/.test(lower)) projectType = "Kitchen remodel";
  else if (/bath/.test(lower)) projectType = "Bath remodel";
  else if (/deck/.test(lower)) projectType = "Deck";
  else if (/roof/.test(lower)) projectType = "Roof";
  else if (/fence/.test(lower)) projectType = "Fence";
  else if (/paint/.test(lower)) projectType = "Paint";
  else if (/adu|addition/.test(lower)) projectType = "Addition";
  else if (/electrical|panel/.test(lower)) projectType = "Electrical";
  else if (/basement/.test(lower)) projectType = "Basement";

  return {
    name,
    email,
    phone,
    address,
    city: null,
    sqft,
    valueLowCents,
    valueHighCents,
    projectType,
    scope: trimmed,
  };
}
