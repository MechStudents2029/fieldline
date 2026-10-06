export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 1_000_000;

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportParseError";
  }
}

export type CsvTable = {
  headers: string[];
  rows: string[][];
  delimiter: "," | ";";
};

export function parseCsv(input: string): CsvTable {
  if (byteLength(input) > MAX_IMPORT_BYTES) throw new ImportParseError("File is over 1 MB.");
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) throw new ImportParseError("The file is empty.");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const delimiter = detectDelimiter(text);
  const records = parseRecords(text, delimiter).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (records.length === 0) throw new ImportParseError("The file has no rows.");
  const [headers, ...rows] = records;
  if (rows.length === 0) throw new ImportParseError("The file has no rows.");
  if (rows.length > MAX_IMPORT_ROWS) throw new ImportParseError("5,000 rows is the limit.");
  return {
    headers: headers.map((header, index) => header.trim() || `Column ${index + 1}`),
    rows,
    delimiter,
  };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function detectDelimiter(text: string): "," | ";" {
  let inQuotes = false;
  let commas = 0;
  let semis = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === "\n") break;
    if (!inQuotes && ch === ",") commas += 1;
    if (!inQuotes && ch === ";") semis += 1;
  }
  return semis > commas ? ";" : ",";
}

function parseRecords(text: string, delimiter: "," | ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
