"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import type { Action, Condition, RuleDraft, Trigger } from "@/lib/services/automations";
import { saveAutomationAction } from "@/app/(office)/settings/automations/actions";

const TRIGGERS = [
  ["job_status", "Job status"],
  ["proposal_signed", "Proposal signed"],
  ["schedule_done", "Schedule done"],
  ["inspection_result", "Inspection result"],
  ["punch_verified", "Punch verified"],
  ["invoice_overdue", "Invoice overdue"],
  ["vendor_expiring", "Vendor expiring"],
  ["equipment_overdue", "Equipment overdue"],
] as const;

const ACTIONS = [
  ["", "Action"],
  ["apply_template", "Apply template"],
  ["todo", "Create to-do"],
  ["today", "Today row"],
  ["set_status", "Set job status"],
  ["punch", "Create punch"],
  ["hold", "Hold schedule"],
  ["release", "Release schedule"],
] as const;

type Options = {
  templates: { id: string; name: string }[];
  people: { id: string; name: string }[];
};

function triggerKind(trigger: Trigger | null) {
  return trigger?.kind ?? "job_status";
}

function blankAction(): Action {
  return { kind: "hold" };
}

export function AutomationSheet({
  rule,
  options,
  targets,
  preview,
}: {
  rule: RuleDraft | null;
  options: Options;
  targets: { id: string; label: string }[];
  preview: string[];
}) {
  const [trigger, setTrigger] = useState<string>(triggerKind(rule?.trigger ?? null));
  const [conditions, setConditions] = useState<string[]>([
    rule?.conditions[0]?.kind ?? "",
    rule?.conditions[1]?.kind ?? "",
  ]);
  const [actions, setActions] = useState<string[]>([
    rule?.actions[0]?.kind ?? "",
    rule?.actions[1]?.kind ?? "",
    rule?.actions[2]?.kind ?? "",
  ]);
  const initial = rule?.actions ?? [];
  const initialConditions = rule?.conditions ?? [];
  return (
    <div data-sheet="automation" className="flex w-full flex-col gap-3 p-4 md:w-[420px]">
      <ActionForm action={saveAutomationAction} className="flex flex-col gap-2">
        {rule?.id ? <input type="hidden" name="id" value={rule.id} /> : null}
        <input type="hidden" name="enabled" value={rule?.enabled === false ? "0" : "1"} />
        <label className="text-[13px]">
          Name
          <input name="name" aria-label="Name" defaultValue={rule?.name ?? ""} required className="field mt-1" />
        </label>
        <label className="text-[13px]">
          Trigger
          <select name="trigger" aria-label="Trigger" className="field mt-1" value={trigger} onChange={(event) => setTrigger(event.target.value)}>
            {TRIGGERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {trigger === "job_status" ? (
          <label className="text-[13px]">
            Status
            <select name="status" aria-label="Status" defaultValue={rule?.trigger.kind === "job_status" ? rule.trigger.status : "active"} className="field mt-1">
              <option value="active">Active</option>
              <option value="complete">Complete</option>
            </select>
          </label>
        ) : null}
        {trigger === "inspection_result" ? (
          <label className="text-[13px]">
            Result
            <select name="result" aria-label="Result" defaultValue={rule?.trigger.kind === "inspection_result" ? rule.trigger.result : "failed"} className="field mt-1">
              <option value="failed">Failed</option>
              <option value="passed">Passed</option>
            </select>
          </label>
        ) : null}
        {trigger === "invoice_overdue" || trigger === "vendor_expiring" ? (
          <label className="text-[13px]">
            Days
            <input name="days" aria-label="Days" type="number" min={0} max={365} defaultValue={rule?.trigger.kind === "invoice_overdue" || rule?.trigger.kind === "vendor_expiring" ? rule.trigger.days : 14} className="field mt-1" />
          </label>
        ) : null}
        {trigger === "vendor_expiring" ? (
          <label className="text-[13px]">
            Certificate
            <select name="cert" aria-label="Certificate" defaultValue={rule?.trigger.kind === "vendor_expiring" ? rule.trigger.cert : "insurance"} className="field mt-1">
              <option value="insurance">Insurance</option>
              <option value="license">License</option>
            </select>
          </label>
        ) : null}
        {conditions.map((kind, index) => (
          <ConditionRow key={index} index={index} kind={kind} initial={initialConditions[index]} options={options} onKind={(value) => setConditions((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)))} />
        ))}
        {actions.map((kind, index) => (
          <ActionRow key={index} index={index} kind={kind} initial={initial[index] ?? blankAction()} options={options} onKind={(value) => setActions((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)))} />
        ))}
        <div className="flex gap-2">
          <button type="submit" className="mac-primary w-fit">
            Save
          </button>
          <Link href="/settings/automations" className="ctl">
            Cancel
          </Link>
        </div>
      </ActionForm>
      {rule?.id ? (
        <form action="/settings/automations" method="get" className="flex items-center gap-2">
          <input type="hidden" name="rule" value={rule.id} />
          <select name="preview" aria-label="Test on" defaultValue="" className="field">
            <option value="">Test on…</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
          <button type="submit" className="ctl">
            Test
          </button>
        </form>
      ) : null}
      {preview.length > 0 ? (
        <ul aria-label="Preview" className="mac-t13">
          {preview.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function conditionValue(condition: Condition | undefined) {
  if (!condition) return "";
  if (condition.kind === "template") return condition.templateId;
  if (condition.kind === "pm") return condition.userId;
  if (condition.kind === "amount_over" || condition.kind === "amount_under") return (condition.cents / 100).toFixed(0);
  return condition.value;
}

function ConditionRow({
  index,
  kind,
  initial,
  options,
  onKind,
}: {
  index: number;
  kind: string;
  initial: Condition | undefined;
  options: Options;
  onKind: (value: string) => void;
}) {
  const value = initial && initial.kind === kind ? conditionValue(initial) : "";
  return (
    <div className="flex flex-col gap-2">
      <select name={`c${index}kind`} aria-label={`Condition ${index + 1}`} className="field" value={kind} onChange={(event) => onKind(event.target.value)}>
        <option value="">Condition</option>
        <option value="job_type">Job type</option>
        <option value="template">Template</option>
        <option value="pm">PM</option>
        <option value="cost_code">Cost code</option>
        <option value="item_name">Item name</option>
        <option value="amount_over">Amount over</option>
        <option value="amount_under">Amount under</option>
      </select>
      {kind === "template" ? (
        <select name={`c${index}value`} aria-label={`Value ${index + 1}`} defaultValue={value} className="field">
          <option value="">Template</option>
          {options.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      ) : null}
      {kind === "pm" ? (
        <select name={`c${index}value`} aria-label={`Value ${index + 1}`} defaultValue={value} className="field">
          <option value="">PM</option>
          {options.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      ) : null}
      {kind && kind !== "template" && kind !== "pm" ? (
        <input name={`c${index}value`} aria-label={`Value ${index + 1}`} defaultValue={value} className="field" />
      ) : null}
    </div>
  );
}

function ActionRow({
  index,
  kind,
  initial,
  options,
  onKind,
}: {
  index: number;
  kind: string;
  initial: Action;
  options: Options;
  onKind: (value: string) => void;
}) {
  const who = initial.kind === "todo" || initial.kind === "today" ? initial.who : "";
  const title = initial.kind === "todo" || initial.kind === "today" || initial.kind === "punch" ? initial.title : "";
  return (
    <div className="flex flex-col gap-2">
      <select name={`a${index}kind`} aria-label={`Action ${index + 1}`} className="field" value={kind} onChange={(event) => onKind(event.target.value)}>
        {ACTIONS.map(([value, label]) => (
          <option key={value || "none"} value={value}>
            {label}
          </option>
        ))}
      </select>
      {kind === "apply_template" ? (
        <select name={`a${index}template`} aria-label="Template" defaultValue={initial.kind === "apply_template" ? initial.templateId : ""} className="field">
          <option value="">Template</option>
          {options.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      ) : null}
      {kind === "todo" || kind === "today" || kind === "punch" ? (
        <input name={`a${index}title`} aria-label={index === 0 ? "Title" : `Title ${index + 1}`} defaultValue={title} className="field" />
      ) : null}
      {kind === "todo" || kind === "today" ? (
        <select name={`a${index}who`} aria-label="Who" defaultValue={who} className="field">
          <option value="">Who</option>
          <option value="role:pm">PM</option>
          <option value="role:office">Office</option>
          <option value="role:field">Field</option>
          {options.people.map((person) => (
            <option key={person.id} value={`user:${person.id}`}>
              {person.name}
            </option>
          ))}
        </select>
      ) : null}
      {kind === "todo" ? <input name={`a${index}days`} aria-label="Due days" type="number" min={0} max={365} defaultValue={initial.kind === "todo" ? initial.dueDays : 0} className="field" /> : null}
      {kind === "set_status" ? (
        <select name={`a${index}status`} aria-label="Job status" defaultValue={initial.kind === "set_status" ? initial.status : "active"} className="field">
          <option value="active">Active</option>
          <option value="complete">Complete</option>
        </select>
      ) : null}
    </div>
  );
}
