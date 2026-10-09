"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { setGroupPresentationAction, syncEstimateGridAction, ungroupAssemblyAction } from "@/app/actions";
import { AddAssembly, AssemblyGroupRow, groupPrice, measurementLabel } from "@/components/mac/add-assembly";
import { FormulaBar, MeasurementsPanel } from "@/components/mac/measurements";
import { defaultSchedule } from "@/lib/domain/snapshot";
import { evaluateFormula, formulaHint } from "@/lib/estimate/formula";
import type { Billing } from "@/lib/estimate/pricing";
import { groupSubtotals, repriceToMargin, sumCounting } from "@/lib/estimate/pricing";
import { formatPercent, formatQty, formatWhole, lineAmounts, lineInputError, milliToQty, parseMoneyToCents, qtyToMilli, scheduleAmounts } from "@/lib/money";

export type WorkspaceLine = {
  id: string;
  sectionId: string;
  name: string;
  qtyMilli: number;
  unit: string;
  unitCostCents: number;
  markupBps: number;
  costCode: string | null;
  billing: Billing;
  sortOrder: number;
  aiConfidenceMilli: number | null;
  sourceNote: string | null;
  qtyFormula: string | null;
  wasteBps: number;
  roundToMilli: number | null;
  groupId: string | null;
  qtyOverridden: boolean;
};

export type WorkspaceMeasure = { id: string; name: string; valueMilli: number; unit: string };

export type WorkspaceGroup = {
  id: string;
  name: string;
  sectionId: string;
  measurementId: string;
  presentAs: string;
};

export type WorkspaceAssembly = { id: string; name: string };

export type WorkspaceSection = { id: string; name: string; sortOrder: number };

type Col = "name" | "qty" | "unit" | "cost" | "markup";

const COLS: Col[] = ["name", "qty", "unit", "cost", "markup"];

function namedSignature(rows: WorkspaceLine[]) {
  return JSON.stringify(
    rows
      .filter((row) => row.name.trim())
      .map((row) => ({
        id: row.id,
        sectionId: row.sectionId,
        name: row.name.trim(),
        qtyMilli: row.qtyMilli,
        unit: row.unit,
        unitCostCents: row.unitCostCents,
        markupBps: row.markupBps,
        billing: row.billing,
        costCode: row.costCode,
        sortOrder: row.sortOrder,
        formula: row.qtyFormula,
        wasteBps: row.wasteBps,
        roundToMilli: row.roundToMilli,
        groupId: row.groupId,
        qtyOverridden: row.qtyOverridden,
      })),
  );
}

function flatten(rows: WorkspaceLine[], sections: WorkspaceSection[]) {
  const order = [...sections].sort((a, b) => a.sortOrder - b.sortOrder);
  return order.flatMap((section) =>
    rows.filter((row) => row.sectionId === section.id).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
  );
}

function normalize(rows: WorkspaceLine[], sections: WorkspaceSection[]) {
  const next = rows.map((row) => ({ ...row }));
  for (const section of sections) {
    const members = next.filter((row) => row.sectionId === section.id).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    members.forEach((row, index) => {
      row.sortOrder = index;
    });
  }
  return next;
}

function parseCell(col: Col, text: string): { partial: true } | { error: string } | { patch: Partial<WorkspaceLine> } {
  if (col === "name") return { patch: { name: text } };
  if (col === "unit") {
    const unit = text.trim();
    if (!unit) return { error: "Check the line." };
    return { patch: { unit: unit.slice(0, 12) } };
  }
  if (col === "qty") {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed === ".") return { partial: true };
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return { error: "Quantity must be greater than zero." };
    const qty = Number(trimmed);
    const error = lineInputError({ qty });
    if (error) return { error };
    return { patch: { qtyMilli: qtyToMilli(qty) } };
  }
  if (col === "cost") {
    const cleaned = text.replace(/[$,\s]/g, "");
    if (cleaned === "" || /^\d+\.$/.test(cleaned)) return { partial: true };
    const cents = parseMoneyToCents(text);
    if (cents == null) return { error: "Unit cost must be zero or a positive amount under $10,000,000." };
    return { patch: { unitCostCents: cents } };
  }
  const trimmed = text.trim();
  if (trimmed === "" || /^\d+\.$/.test(trimmed)) return { partial: true };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { error: "Markup must be between 0% and 500%." };
  const markupBps = Math.round(Number(trimmed) * 100);
  const error = lineInputError({ markupBps });
  if (error) return { error };
  return { patch: { markupBps } };
}

function shownText(line: WorkspaceLine, col: Col, draft: { id: string; col: Col; text: string } | null) {
  if (draft && draft.id === line.id && draft.col === col) return draft.text;
  if (col === "name") return line.name;
  if (col === "qty") return formatQty(line.qtyMilli);
  if (col === "unit") return line.unit;
  if (col === "cost") return (line.unitCostCents / 100).toFixed(2);
  return (line.markupBps / 100).toFixed(1);
}

function fieldOf(col: Col): keyof WorkspaceLine {
  if (col === "qty") return "qtyMilli";
  if (col === "cost") return "unitCostCents";
  if (col === "markup") return "markupBps";
  return col;
}

export function EstimateWorkspace({
  userId,
  estimateId,
  locked,
  sections,
  lines: initialLines,
  measurements,
  groups,
  assemblies,
  comments,
  marginTargetBps,
  depositBps,
  progressBps,
  finalBps,
  clientName,
  address,
  version,
  sqft,
  budgetLabel,
  photos,
  children,
}: {
  userId: string;
  estimateId: string;
  locked: boolean;
  sections: WorkspaceSection[];
  lines: WorkspaceLine[];
  measurements: WorkspaceMeasure[];
  groups: WorkspaceGroup[];
  assemblies: WorkspaceAssembly[];
  comments?: React.ReactNode;
  marginTargetBps: number;
  depositBps: number;
  progressBps: number;
  finalBps: number;
  clientName: string;
  address: string;
  version: number;
  sqft: number | null;
  budgetLabel: string | null;
  photos: { src: string; caption: string }[];
  children: React.ReactNode;
}) {
  const [sectionRows, setSectionRows] = useState(sections);
  const [lines, setLines] = useState(initialLines);
  const [draft, setDraft] = useState<{ id: string; col: Col; text: string } | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const router = useRouter();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [targetText, setTargetText] = useState(String(Math.round(marginTargetBps / 100)));
  const storageKey = `fl-estimate-preview:${userId}`;
  const previewOn = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("fieldline-preview", onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener("fieldline-preview", onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => window.localStorage.getItem(storageKey) !== "0",
    () => true,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<WorkspaceLine | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const ackSig = useRef(namedSignature(initialLines));
  const ackLines = useRef(initialLines);
  const forceTarget = useRef<number | undefined>(undefined);
  const ticketRef = useRef(0);
  const holdSync = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const focusRef = useRef<{ id: string; col: Col } | null>(null);
  const editStart = useRef<{ id: string; col: Col; snapshot: WorkspaceLine } | null>(null);

  useEffect(() => {
    const incoming = namedSignature(initialLines);
    if (incoming === ackSig.current) return;
    if (namedSignature(lines) !== ackSig.current) return;
    holdSync.current = true;
    ackLines.current = initialLines;
    ackSig.current = incoming;
    setLines(initialLines);
  }, [initialLines, lines]);

  useEffect(() => {
    if (!focusRef.current) return;
    const { id, col } = focusRef.current;
    const node = document.querySelector<HTMLElement>(`[data-line="${id}"][data-col="${col}"]`);
    if (node) {
      focusRef.current = null;
      node.focus();
    }
  }, [lines, focusNonce]);

  useEffect(() => {
    if (locked) return;
    if (holdSync.current) {
      holdSync.current = false;
      return;
    }
    const signature = namedSignature(lines);
    if (signature === ackSig.current && forceTarget.current == null) return;
    const handle = window.setTimeout(() => {
      const ticket = ++ticketRef.current;
      const named = lines.filter((row) => row.name.trim());
      const persisted = JSON.parse(ackSig.current) as { id: string }[];
      const present = new Set(lines.map((row) => row.id));
      const deletedIds = persisted.map((row) => row.id).filter((id) => !present.has(id));
      const nextTarget = forceTarget.current;
      forceTarget.current = undefined;
      void syncEstimateGridAction({
        estimateId,
        lines: named.map((row) => ({
          id: row.id,
          sectionId: row.sectionId,
          name: row.name.trim(),
          qty: milliToQty(row.qtyMilli),
          unit: row.unit || "ea",
          unitCostCents: row.unitCostCents,
          markupBps: row.markupBps,
          billing: row.billing,
          costCode: row.costCode,
          sortOrder: row.sortOrder,
          formula: row.qtyFormula,
          wasteBps: row.wasteBps,
          roundToMilli: row.roundToMilli,
          groupId: row.groupId,
          qtyOverridden: row.qtyOverridden,
        })),
        deletedIds,
        ...(nextTarget != null ? { marginTargetBps: nextTarget } : {}),
      }).then((result) => {
        if (ticket !== ticketRef.current) return;
        if (result?.error) {
          setError(result.error);
          setLines(ackLines.current);
          return;
        }
        ackLines.current = lines;
        ackSig.current = signature;
        setError(null);
        setNotice("Line saved.");
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [lines, locked, estimateId]);

  const flat = useMemo(() => flatten(lines, sectionRows), [lines, sectionRows]);
  const totals = useMemo(() => sumCounting(lines), [lines]);
  const targetBps = /^\d+(\.\d+)?$/.test(targetText.trim()) ? Math.round(Number(targetText) * 100) : null;
  const targetOk = targetBps != null && targetBps >= 0 && targetBps <= 9000;
  const previewTotals = useMemo(() => {
    if (!targetOk || targetBps == null) return null;
    const scope = selectedGroup ? lines.filter((row) => row.sectionId === selectedGroup) : lines;
    try {
      const next = new Map(repriceToMargin(scope, targetBps).map((row) => [row.id, row.markupBps]));
      const merged = lines.map((row) => (next.has(row.id) ? { ...row, markupBps: next.get(row.id)! } : row));
      return { merged, totals: sumCounting(merged) };
    } catch {
      return null;
    }
  }, [lines, selectedGroup, targetBps, targetOk]);
  const deposit = Math.round((totals.priceCents * depositBps) / 10000);
  const under = totals.marginBps != null && totals.marginBps < marginTargetBps;

  function togglePreview() {
    window.localStorage.setItem(storageKey, previewOn ? "0" : "1");
    window.dispatchEvent(new Event("fieldline-preview"));
  }

  function patchLine(id: string, patch: Partial<WorkspaceLine>, clearConfidence: boolean) {
    setLines((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch, aiConfidenceMilli: clearConfidence ? null : row.aiConfidenceMilli };
        if (patch.qtyMilli != null && patch.qtyMilli !== row.qtyMilli) {
          next.qtyFormula = null;
          next.wasteBps = 0;
          next.roundToMilli = null;
          if (row.groupId) next.qtyOverridden = true;
        }
        return next;
      }),
    );
  }

  function measuresForFormula() {
    return measurements.map((row) => ({ name: row.name, valueMilli: row.valueMilli }));
  }

  function useTyped(id: string) {
    setLines((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, qtyFormula: null, wasteBps: 0, roundToMilli: null, qtyOverridden: row.groupId ? true : row.qtyOverridden }
          : row,
      ),
    );
    setSelectedId(id);
  }

  function useFormula(id: string, expr: string, wasteBps: number, roundToMilli: number | null) {
    try {
      const qtyMilli = evaluateFormula({ expr, wasteBps, roundToMilli, measurements: measuresForFormula() });
      setError(null);
      setLines((current) =>
        current.map((row) =>
          row.id === id ? { ...row, qtyFormula: expr, wasteBps, roundToMilli, qtyMilli, qtyOverridden: false, aiConfidenceMilli: null } : row,
        ),
      );
      setSelectedId(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Check the formula.");
    }
  }

  function addBelow(afterId: string | null) {
    if (locked) return;
    const ordered = flatten(lines, sectionRows);
    const after = lines.find((row) => row.id === afterId) ?? ordered.at(-1);
    let sectionId = after?.sectionId ?? sectionRows[0]?.id;
    if (!sectionId) {
      sectionId = `sec_${crypto.randomUUID()}`;
      const created = sectionId;
      setSectionRows((rows) => [...rows, { id: created, name: "Added", sortOrder: rows.length }]);
    }
    const id = `li_${crypto.randomUUID()}`;
    const sortOrder = (after?.sortOrder ?? -1) + 1;
    focusRef.current = { id, col: "name" };
    setLines((current) => [
      ...current.map((row) => (row.sectionId === sectionId && row.sortOrder >= sortOrder ? { ...row, sortOrder: row.sortOrder + 1 } : row)),
      {
        id,
        sectionId: sectionId!,
        name: "",
        qtyMilli: 1000,
        unit: "ea",
        unitCostCents: 0,
        markupBps: 3500,
        costCode: null,
        billing: "included" as const,
        sortOrder,
        aiConfidenceMilli: null,
        sourceNote: null,
        qtyFormula: null,
        wasteBps: 0,
        roundToMilli: null,
        groupId: null,
        qtyOverridden: false,
      },
    ]);
    setFocusNonce((value) => value + 1);
  }

  function removeLine(id: string) {
    const line = lines.find((row) => row.id === id);
    if (!line || locked) return;
    setUndo(line);
    setLines((current) => current.filter((row) => row.id !== id));
    setNotice(null);
  }

  function moveLine(id: string, dir: -1 | 1) {
    if (locked) return;
    setLines((current) => {
      const ordered = flatten(current, sectionRows);
      const index = ordered.findIndex((row) => row.id === id);
      const neighbor = ordered[index + dir];
      if (!neighbor) return current;
      return normalize(
        current.map((row) => (row.id === id ? { ...row, sectionId: neighbor.sectionId, sortOrder: neighbor.sortOrder + (dir > 0 ? 1 : -1) } : row)),
        sectionRows,
      );
    });
  }

  function placeLine(id: string, sectionId: string, sortOrder: number) {
    if (locked || !id) return;
    setLines((current) => normalize(current.map((row) => (row.id === id ? { ...row, sectionId, sortOrder } : row)), sectionRows));
  }

  function onKey(event: React.KeyboardEvent<HTMLInputElement>, line: WorkspaceLine, col: Col) {
    if (locked) return;
    if (event.key === "Escape") {
      event.preventDefault();
      const start = editStart.current;
      if (start && start.id === line.id) {
        const key = fieldOf(start.col);
        setLines((current) => current.map((row) => (row.id === line.id ? { ...row, [key]: start.snapshot[key] } : row)));
      }
      setDraft(null);
      setError(null);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      addBelow(line.id);
      return;
    }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      moveLine(line.id, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (col === "name" && (event.key === "Backspace" || event.key === "Delete") && shownText(line, "name", draft) === "") {
      event.preventDefault();
      removeLine(line.id);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const index = flat.findIndex((row) => row.id === line.id);
      const next = flat[index + 1];
      if (next) {
        focusRef.current = { id: next.id, col };
        setFocusNonce((value) => value + 1);
      }
    }
  }

  function applyTarget() {
    if (!previewTotals || targetBps == null || locked) return;
    forceTarget.current = targetBps;
    setNotice(null);
    setLines(previewTotals.merged);
  }

  const schedule = scheduleAmounts(totals.priceCents, defaultSchedule({ depositBps, progressBps, finalBps }));
  const perSqft = sqft && sqft > 0 ? Math.round(totals.priceCents / sqft) : null;

  return (
    <>
      <div className="estimate-totals">
        <div className="estimate-reprice">
          <label className="est-target">
            Target
            <input
              aria-label="Target margin"
              inputMode="decimal"
              className="est-target-input"
              value={targetText}
              disabled={locked}
              onChange={(event) => setTargetText(event.target.value)}
            />
            %
          </label>
          {previewTotals ? (
            <p data-testid="reprice-preview" className="est-reprice-preview">
              {selectedGroup ? sectionRows.find((section) => section.id === selectedGroup)?.name : "All"} {formatPercent(previewTotals.totals.marginBps)} ·{" "}
              {formatWhole(previewTotals.totals.priceCents)}
            </p>
          ) : null}
          <button type="button" className="est-apply" disabled={!previewTotals || locked} onClick={applyTarget}>
            Apply
          </button>
          {notice ? (
            <p role="status" className="est-saved">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="est-error">
              {error}
            </p>
          ) : null}
        </div>
        <span className="estimate-deposit">
          Deposit {formatPercent(depositBps)} {formatWhole(deposit)}
        </span>
        <div className="fl-strip">
          <div>
            <p className="fl-number" data-testid="gross-price">
              {formatWhole(totals.priceCents)}
            </p>
            <p className="fl-footnote">Price</p>
          </div>
          <div>
            <p className="fl-number" data-testid="gross-cost">
              {formatWhole(totals.costCents)}
            </p>
            <p className="fl-footnote">Cost</p>
          </div>
          <div>
            <p className={`fl-number ${under ? "fl-late" : ""}`} data-testid="gross-margin">
              {formatPercent(totals.marginBps)}
            </p>
            <p className="fl-footnote">Margin</p>
          </div>
        </div>
      </div>
      <div className="estimate-phone-measures">
        {measurements.map((row) => (
          <p key={row.id}>
            {row.name} <span className="num">{formatQty(row.valueMilli)}</span> {row.unit}
          </p>
        ))}
      </div>
      {children}
      <div className="estimate-mac">
        <div className="estimate-grid-wrap">
          <div role="grid" aria-label="Estimate lines" className="est-grid">
            <div role="row" className="est-head">
              <span role="columnheader" />
              <span role="columnheader">Item</span>
              <span role="columnheader">Code</span>
              <span role="columnheader">Qty</span>
              <span role="columnheader">Unit</span>
              <span role="columnheader">Unit cost</span>
              <span role="columnheader">Markup</span>
              <span role="columnheader">Amount</span>
              <span role="columnheader">Billing</span>
            </div>
            {sectionRows
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((section) => {
                const members = lines.filter((row) => row.sectionId === section.id).sort((a, b) => a.sortOrder - b.sortOrder);
                const sub = groupSubtotals(members);
                const open = !collapsed.includes(section.id);
                return (
                  <div key={section.id}>
                    <div
                      role="row"
                      className={`est-group ${selectedGroup === section.id ? "is-selected" : ""}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        placeLine(event.dataTransfer.getData("text/plain"), section.id, 100_000);
                      }}
                    >
                      <button
                        type="button"
                        className="est-twist"
                        aria-expanded={open}
                        aria-label={`${open ? "Collapse" : "Expand"} ${section.name}`}
                        onClick={() => setCollapsed((current) => (current.includes(section.id) ? current.filter((id) => id !== section.id) : [...current, section.id]))}
                      >
                        {open ? "▾" : "▸"}
                      </button>
                      <button
                        type="button"
                        className="est-group-name"
                        aria-pressed={selectedGroup === section.id}
                        onClick={() => setSelectedGroup((current) => (current === section.id ? null : section.id))}
                      >
                        {section.name}
                      </button>
                      <span className="est-group-sub">
                        {formatWhole(sub.costCents)} · {formatPercent(sub.marginBps)} · {formatWhole(sub.priceCents)}
                      </span>
                    </div>
                    {open
                      ? members.flatMap((line, index) => {
                          const amounts = lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps);
                          const measure = /site measure/i.test(line.sourceNote ?? "");
                          const confidence = line.aiConfidenceMilli != null ? `${Math.round(line.aiConfidenceMilli / 10)}% confidence` : undefined;
                          const group = line.groupId ? groups.find((item) => item.id === line.groupId) : undefined;
                          const first = Boolean(group && members.findIndex((row) => row.groupId === line.groupId) === index);
                          const groupOpen = !line.groupId || !collapsedGroups.includes(line.groupId);
                          const header = first && group ? (
                            <AssemblyGroupRow
                              key={group.id}
                              name={group.name}
                              presentAs={group.presentAs}
                              open={groupOpen}
                              locked={locked}
                              {...measurementLabel(measurements.find((row) => row.id === group.measurementId))}
                              priceCents={groupPrice(members.filter((row) => row.groupId === group.id))}
                              onToggle={() =>
                                setCollapsedGroups((current) =>
                                  current.includes(group.id) ? current.filter((id) => id !== group.id) : [...current, group.id],
                                )
                              }
                              onUngroup={() => {
                                void ungroupAssemblyAction(group.id).then((result) => {
                                  if (result?.error) setError(result.error);
                                  else router.refresh();
                                });
                              }}
                              onPresent={() => {
                                void setGroupPresentationAction(group.id, group.presentAs === "parts" ? "one" : "parts").then((result) => {
                                  if (result?.error) setError(result.error);
                                  else router.refresh();
                                });
                              }}
                            />
                          ) : null;
                          if (!groupOpen) return header ? [header] : [];
                          const row = (
                            <div
                              role="row"
                              key={line.id}
                              data-group={line.groupId ?? undefined}
                              className={`est-line ${line.billing === "excluded" ? "is-excluded" : ""} ${line.groupId ? "is-part" : ""}`}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                placeLine(event.dataTransfer.getData("text/plain"), line.sectionId, line.sortOrder - 1);
                              }}
                            >
                              <button
                                type="button"
                                className="est-drag"
                                draggable={!locked}
                                aria-label="Move line"
                                onDragStart={(event) => {
                                  event.dataTransfer.setData("text/plain", line.id);
                                  event.dataTransfer.effectAllowed = "move";
                                }}
                              >
                                ⋮⋮
                              </button>
                              <span className="est-item">
                                {COLS[0] === "name" ? (
                                  <input
                                    data-line={line.id}
                                    data-col="name"
                                    aria-label="Item"
                                    className="est-cell"
                                    value={shownText(line, "name", draft)}
                                    disabled={locked}
                                    onFocus={() => {
                                      editStart.current = { id: line.id, col: "name", snapshot: { ...line } };
                                    }}
                                    onChange={(event) => {
                                      const text = event.target.value;
                                      setDraft({ id: line.id, col: "name", text });
                                      if (text.trim()) patchLine(line.id, { name: text }, true);
                                    }}
                                    onBlur={() => {
                                      if (draft?.id === line.id && draft.col === "name") setDraft(null);
                                    }}
                                    title={confidence}
                                    onKeyDown={(event) => onKey(event, line, "name")}
                                  />
                                ) : null}
                                {measure ? <span className="fl-close est-measure">Measure on site</span> : null}
                                {line.qtyOverridden ? <span className="est-override">Override</span> : null}
                              </span>
                              <span className="est-code">{line.costCode}</span>
                              <span className="est-qty">
                                <input
                                  data-line={line.id}
                                  data-col="qty"
                                  aria-label="Qty"
                                  className="est-cell num"
                                  title={
                                    line.qtyFormula
                                      ? formulaHint({
                                          expr: line.qtyFormula,
                                          wasteBps: line.wasteBps,
                                          roundToMilli: line.roundToMilli,
                                          measurements: measuresForFormula(),
                                          unit: line.unit,
                                        })
                                      : line.qtyOverridden
                                        ? "Override"
                                        : undefined
                                  }
                                  value={shownText(line, "qty", draft)}
                                  disabled={locked}
                                  readOnly={Boolean(line.qtyFormula)}
                                  inputMode="decimal"
                                  onFocus={() => {
                                    editStart.current = { id: line.id, col: "qty", snapshot: { ...line } };
                                    if (line.qtyFormula) setSelectedId(line.id);
                                  }}
                                  onChange={(event) => {
                                    if (line.qtyFormula) return;
                                    const text = event.target.value;
                                    setDraft({ id: line.id, col: "qty", text });
                                    const parsed = parseCell("qty", text);
                                    if ("patch" in parsed) {
                                      setError(null);
                                      patchLine(line.id, parsed.patch, true);
                                    } else if ("error" in parsed) setError(parsed.error);
                                  }}
                                  onBlur={() => {
                                    if (draft?.id === line.id && draft.col === "qty") setDraft(null);
                                  }}
                                  onKeyDown={(event) => onKey(event, line, "qty")}
                                />
                                {line.qtyFormula ? (
                                  <button type="button" className="est-fx" aria-label={`Formula ${line.name}`} onClick={() => setSelectedId(line.id)}>
                                    fx
                                  </button>
                                ) : null}
                              </span>
                              {(["unit", "cost", "markup"] as Col[]).map((col) => (
                                <input
                                  key={col}
                                  data-line={line.id}
                                  data-col={col}
                                  aria-label={col === "qty" ? "Qty" : col === "unit" ? "Unit" : col === "cost" ? "Unit cost" : "Markup"}
                                  className={`est-cell ${col === "unit" ? "" : "num"}`}
                                  value={shownText(line, col, draft)}
                                  disabled={locked}
                                  inputMode={col === "unit" ? "text" : "decimal"}
                                  onFocus={() => {
                                    editStart.current = { id: line.id, col, snapshot: { ...line } };
                                  }}
                                  onChange={(event) => {
                                    const text = event.target.value;
                                    setDraft({ id: line.id, col, text });
                                    const parsed = parseCell(col, text);
                                    if ("patch" in parsed) {
                                      setError(null);
                                      patchLine(line.id, parsed.patch, true);
                                    } else if ("error" in parsed) setError(parsed.error);
                                  }}
                                  onBlur={() => {
                                    if (draft?.id === line.id && draft.col === col) setDraft(null);
                                  }}
                                  onKeyDown={(event) => onKey(event, line, col)}
                                />
                              ))}
                              <span className={`est-amount num ${line.billing === "optional" || line.billing === "excluded" ? "is-muted" : ""}`}>
                                {formatWhole(amounts.price)}
                              </span>
                              <select
                                aria-label={`Billing ${line.name || "line"}`}
                                className="est-billing"
                                value={line.billing}
                                disabled={locked}
                                onChange={(event) => patchLine(line.id, { billing: event.target.value as Billing }, false)}
                              >
                                <option value="included">Included</option>
                                <option value="optional">Optional</option>
                                <option value="allowance">Allowance</option>
                                <option value="excluded">Excluded</option>
                              </select>
                            </div>
                          );
                          return header ? [header, row] : [row];
                        })
                      : null}
                  </div>
                );
              })}
          </div>
          {locked ? null : (
            <button type="button" className="est-add" onClick={() => addBelow(flat.at(-1)?.id ?? null)}>
              + Add line
            </button>
          )}
          <AddAssembly estimateId={estimateId} locked={locked} assemblies={assemblies} measurements={measurements} />
        </div>
        <aside className="estimate-side" aria-label={previewOn ? "Client preview" : "Inspector"}>
          <MeasurementsPanel estimateId={estimateId} locked={locked} rows={measurements} />
          <FormulaBar
            key={`${selectedId ?? "none"}:${lines.find((row) => row.id === selectedId)?.qtyFormula ?? ""}:${lines.find((row) => row.id === selectedId)?.wasteBps ?? 0}:${lines.find((row) => row.id === selectedId)?.roundToMilli ?? ""}`}
            line={lines.find((row) => row.id === selectedId) ?? null}
            measurements={measurements}
            locked={locked}
            onTyped={useTyped}
            onFormula={useFormula}
          />
          <div className="estimate-comments">{comments}</div>
          <button type="button" className="est-preview-toggle" aria-pressed={previewOn} onClick={togglePreview}>
            Preview
          </button>
          {previewOn ? (
            <div data-testid="client-preview">
              <p className="est-kicker">Proposal</p>
              <p className="est-client">{clientName}</p>
              {address ? <p className="est-muted">{address}</p> : null}
              {sectionRows
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((section) => {
                  const members = lines.filter((row) => row.sectionId === section.id && row.billing !== "excluded" && row.name.trim());
                  if (members.length === 0) return null;
                  return (
                    <section key={section.id} className="est-preview-section">
                      <h2>{section.name}</h2>
                      {members.flatMap((line, index) => {
                        const group = line.groupId ? groups.find((item) => item.id === line.groupId) : undefined;
                        if (group && group.presentAs !== "parts") {
                          if (members.findIndex((row) => row.groupId === line.groupId) !== index) return [];
                          const block = members.filter((row) => row.groupId === line.groupId);
                          const labeled = measurementLabel(measurements.find((row) => row.id === group.measurementId));
                          return [
                            <div key={group.id} className="est-preview-line" data-preview-line={group.id}>
                              <span>
                                {group.name}
                                <span className="est-muted">
                                  {" "}
                                  {labeled.qty} {labeled.unit}
                                </span>
                              </span>
                              <span className="num">{formatWhole(groupPrice(block))}</span>
                            </div>,
                          ];
                        }
                        const amounts = lineAmounts(line.qtyMilli, line.unitCostCents, line.markupBps);
                        return [
                          <div key={line.id} className="est-preview-line" data-preview-line={line.id}>
                            <span>
                              {line.billing === "optional" ? "Optional · " : line.billing === "allowance" ? "Allowance · " : ""}
                              {line.name}
                              <span className="est-muted">
                                {" "}
                                {formatQty(line.qtyMilli)} {line.unit}
                              </span>
                            </span>
                            <span className="num">{formatWhole(amounts.price)}</span>
                          </div>,
                        ];
                      })}
                    </section>
                  );
                })}
              <p className="est-preview-total">
                Total <span data-testid="client-total">{formatWhole(totals.priceCents)}</span>
              </p>
              <ul className="est-schedule">
                {schedule.map((part) => (
                  <li key={part.type}>
                    <span>{part.label}</span>
                    <span className="num">{formatWhole(part.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <p className="est-kicker">Proposal</p>
              <p className="est-client">{clientName}</p>
              {address ? <p>{address}</p> : null}
              <p>Version {version}</p>
              <p className="est-muted">Valid for 30 days</p>
              <p className="est-kicker">Pricing</p>
              <p>Target {formatPercent(marginTargetBps)}</p>
              {budgetLabel ? <p>{budgetLabel}</p> : null}
              {perSqft != null ? <p>{formatWhole(perSqft)} / sq ft</p> : null}
              <p className="est-kicker">Payment schedule</p>
              <p>Deposit {formatPercent(depositBps)} {formatWhole(deposit)}</p>
              <p>Rough-in {formatPercent(progressBps)} {formatWhole(Math.round((totals.priceCents * progressBps) / 10000))}</p>
              <p>Final {formatPercent(finalBps)} {formatWhole(totals.priceCents - deposit - Math.round((totals.priceCents * progressBps) / 10000))}</p>
              {photos.length ? (
                <div className="est-photos">
                  {photos.map((photo) => (
                    <img key={photo.src} src={photo.src} alt={photo.caption || "Site photo"} />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>
      {undo ? (
        <div className="est-toast" role="status">
          <span>Removed</span>
          <button
            type="button"
            onClick={() => {
              setLines((current) => normalize([...current, undo], sectionRows));
              setUndo(null);
              focusRef.current = { id: undo.id, col: "name" };
              setFocusNonce((value) => value + 1);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </>
  );
}
