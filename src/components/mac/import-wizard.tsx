"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { commitImportAction, previewImportAction, undoImportAction } from "@/app/actions";
import { FileButton } from "@/components/file-button";
import { ImportParseError, MAX_IMPORT_BYTES, parseCsv, type CsvTable } from "@/lib/import/csv";
import { FIELD_LABEL, autoMap, fieldsFor, type ImportKind } from "@/lib/import/map";
import { formatWhen } from "@/lib/format";
import { rowCounts, type ImportHistoryRow, type ImportViewRow } from "@/lib/import/review";

export function ImportWizard({ kind, history }: { kind: ImportKind; history: ImportHistoryRow[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [rows, setRows] = useState<ImportViewRow[] | null>(null);
  const [codes, setCodes] = useState<{ code: string; name: string }[]>([]);
  const [step, setStep] = useState<"paste" | "map" | "review">("paste");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function showTable(csv: string) {
    try {
      const parsed = parseCsv(csv);
      setText(csv);
      setTable(parsed);
      setMapping(autoMap(parsed.headers, kind));
      setRows(null);
      setStep("map");
      setError(null);
    } catch (caught) {
      setError(caught instanceof ImportParseError ? caught.message : "The file is empty.");
    }
  }

  async function onReview() {
    setPending(true);
    setError(null);
    const result = await previewImportAction({ kind, csv: text, mapping });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setRows(result.rows);
    setCodes(result.codes);
    setStep("review");
  }

  async function onImport() {
    if (!rows) return;
    setPending(true);
    setError(null);
    const result = await commitImportAction({
      kind,
      csv: text,
      mapping,
      choices: rows.map((row) => ({ index: row.index, choice: row.choice, mapToCode: row.suggestedCode && row.choice === "update" ? row.suggestedCode : "" })),
    });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function onUndo(batchId: string) {
    setPending(true);
    setError(null);
    const result = await undoImportAction(batchId);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    if (result.reason) setError(result.reason);
    router.refresh();
  }

  function setChoice(index: number, choice: ImportViewRow["choice"]) {
    setRows((current) => current?.map((row) => (row.index === index ? { ...row, choice } : row)) ?? null);
  }

  function setCode(index: number, code: string) {
    setRows((current) =>
      current?.map((row) => {
        if (row.index !== index) return row;
        if (!code) return { ...row, choice: "import", status: "new", detail: row.detail || "General" };
        return { ...row, choice: "update", status: "duplicate", detail: "Same code", suggestedCode: code };
      }) ?? null,
    );
  }

  const counts = rows ? rowCounts(rows) : null;
  const fields = fieldsFor(kind);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 pb-3 md:px-4">
        <p className="md:hidden">
          <a href={`/import/template/${kind}`} className="mac-t13 text-[var(--mac-accent)]">
            Template
          </a>
        </p>
        {error ? <p className="mac-t13 text-[var(--mac-danger)]">{error}</p> : null}
        {step === "paste" ? (
          <div className="flex flex-col gap-3">
            <FileButton
              name="spreadsheet"
              label="Spreadsheet file"
              accept=".csv,text/csv,text/plain"
              empty="File"
              onPick={(file) => {
                if (!file) return;
                if (file.size > MAX_IMPORT_BYTES) {
                  setError("File is over 1 MB.");
                  return;
                }
                void file.text().then(showTable);
              }}
            />
            <textarea aria-label="CSV" value={text} onChange={(event) => setText(event.target.value)} className="field min-h-40 font-mono text-[13px]" />
          </div>
        ) : null}
        {step === "map" && table ? (
          <>
            <div className="hidden md:block">
              <table className="mac-table">
                <thead>
                  <tr>
                    <th className="px-2">Column</th>
                    <th className="px-2">Sample</th>
                    <th className="px-2">Field</th>
                  </tr>
                </thead>
                <tbody>
                  {table.headers.map((header, index) => (
                    <tr key={`${header}-${index}`}>
                      <td className="px-2">{header}</td>
                      <td className="px-2 text-[var(--mac-secondary)]">{table.rows[0]?.[index] || ""}</td>
                      <td className="px-2">{fieldSelect(header, index, mapping, fields, setMapping)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col gap-3 md:hidden">
              {table.headers.map((header, index) => (
                <li key={`${header}-${index}`} className="flex flex-col gap-1">
                  <span className="mac-t13">{header}</span>
                  <span className="mac-t11 text-[var(--mac-secondary)]">{table.rows[0]?.[index] || "—"}</span>
                  {fieldSelect(header, index, mapping, fields, setMapping)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {step === "review" && rows ? (
          <>
            <div className="hidden md:block">
              <table className="mac-table">
                <thead>
                  <tr>
                    <th className="px-2">Name</th>
                    <th className="px-2">Detail</th>
                    <th className="px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.index}>
                      <td className="px-2">{row.label || "—"}</td>
                      <td className="px-2 text-[var(--mac-secondary)]">{row.detail}</td>
                      <td className="px-2">{statusCell(row, codes, setChoice, setCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col gap-3 md:hidden">
              {rows.map((row) => (
                <li key={row.index} className="flex flex-col gap-1 border-b border-[var(--mac-separator)] py-2">
                  <span className="mac-t13">{row.label || "—"}</span>
                  {row.detail ? <span className="mac-t11 text-[var(--mac-secondary)]">{row.detail}</span> : null}
                  {statusCell(row, codes, setChoice, setCode)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {history.length > 0 ? (
          <div>
            <h2 className="mac-t11 text-[var(--mac-secondary)]">History</h2>
            <ul className="mt-1">
              {history.map((batch) => (
                <li key={batch.id} className="flex h-7 items-center gap-3 mac-t13">
                  <span>{kindLabel(batch.kind)}</span>
                  <span className="num text-[var(--mac-secondary)]">{formatWhen(batch.createdAt)}</span>
                  <span className="num text-[var(--mac-secondary)]">{batch.summary.new} new</span>
                  {batch.reason ? <span className="text-[var(--mac-danger)]">{batch.reason}</span> : null}
                  {batch.undoneAt ? <span className="text-[var(--mac-secondary)]">Undone</span> : <button type="button" className="mac-glass-btn" disabled={pending} onClick={() => void onUndo(batch.id)}>Undo</button>}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {step === "review" && counts ? (
        <div className="flex h-[30px] items-center gap-3 px-4 mac-t11 text-[var(--mac-secondary)]">
          <span><span className="num">{counts.new}</span> new</span>
          <span><span className="num">{counts.update}</span> update</span>
          <span><span className="num">{counts.duplicate}</span> duplicate</span>
          <span><span className="num">{counts.error}</span> error</span>
        </div>
      ) : null}
      <div className="flex items-center gap-2 px-4 pb-3">
        {step === "paste" ? (
          <button type="button" data-mac-primary className="mac-primary" onClick={() => showTable(text)}>
            Continue
          </button>
        ) : null}
        {step === "map" ? (
          <>
            <button type="button" className="mac-glass-btn" onClick={() => setStep("paste")}>
              Back
            </button>
            <button type="button" data-mac-primary className="mac-primary" disabled={pending} onClick={() => void onReview()}>
              Review
            </button>
          </>
        ) : null}
        {step === "review" ? (
          <>
            <button type="button" className="mac-glass-btn" onClick={() => setStep("map")}>
              Back
            </button>
            <button type="button" data-mac-primary className="mac-primary" disabled={pending || !rows?.some((row) => row.choice === "import" || row.choice === "update")} onClick={() => void onImport()}>
              Import
            </button>
          </>
        ) : null}
        <a href={`/import/template/${kind}`} className="mac-glass-btn hidden md:inline-flex">
          Template
        </a>
      </div>
    </div>
  );
}

function fieldSelect(header: string, index: number, mapping: string[], fields: readonly string[], setMapping: (next: string[]) => void) {
  return (
    <select
      aria-label={`${header} column`}
      value={mapping[index] || ""}
      className="h-[22px] max-w-full bg-transparent text-[13px]"
      onChange={(event) => {
        const next = mapping.slice();
        next[index] = event.target.value;
        setMapping(next);
      }}
    >
      <option value="">Skip</option>
      {fields.map((field) => (
        <option key={field} value={field}>
          {FIELD_LABEL[field]}
        </option>
      ))}
    </select>
  );
}

function statusCell(
  row: ImportViewRow,
  codes: { code: string; name: string }[],
  setChoice: (index: number, choice: ImportViewRow["choice"]) => void,
  setCode: (index: number, code: string) => void,
) {
  if (row.error) return <span className="text-[var(--mac-danger)]">{row.error}</span>;
  if (row.codeChoices) {
    return (
      <select aria-label={`Cost code for ${row.label}`} value={row.choice === "update" ? row.suggestedCode || "" : ""} className="h-[22px] max-w-full bg-transparent text-[13px]" onChange={(event) => setCode(row.index, event.target.value)}>
        <option value="">New</option>
        {codes.map((code) => (
          <option key={code.code} value={code.code}>
            {code.code}
          </option>
        ))}
      </select>
    );
  }
  if (row.status === "duplicate") {
    return (
      <select aria-label={`Choice for ${row.label}`} value={row.choice} className="h-[22px] bg-transparent text-[13px]" onChange={(event) => setChoice(row.index, event.target.value === "update" ? "update" : "skip")}>
        <option value="skip">Skip</option>
        <option value="update">Update</option>
      </select>
    );
  }
  return <span>New</span>;
}

function kindLabel(kind: string) {
  if (kind === "vendors") return "Vendors";
  if (kind === "price_book") return "Price book";
  return "Contacts";
}
