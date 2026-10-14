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
  ["schedule_declined", "Schedule item declined"],
  ["unconfirmed_before", "Unconfirmed N days before start"],
  ["inspection_result", "Inspection result"],
  ["punch_verified", "Punch verified"],
  ["invoice_overdue", "Invoice overdue"],
  ["vendor_expiring", "Vendor expiring"],
  ["equipment_overdue", "Equipment overdue"],
  ["incident_logged", "Incident logged"],
  ["checklist_failed", "Checklist item failed"],
  ["tm_verified", "T&M ticket verified"],
  ["selection_confirmed", "Selection confirmed"],
  ["delivery_late", "Delivery late"],
  ["delivery_received", "Delivery received"],
  ["vendor_credit_issued", "Vendor credit issued"],
  ["stock_low", "Low stock"],
  ["clock_outside", "Clock punch outside job site"],
  ["visit_due", "Visit due"],
  ["agreement_expiring", "Agreement expiring"],
  ["unassigned_today", "Unassigned visit today"],
  ["booking_created", "Online booking created"],
  ["review_request_created", "Review request created"],
  ["review_request_marked_sent", "Review marked sent"],
  ["invoice_followup_created", "Invoice follow-up created"],
  ["invoice_followup_marked_sent", "Invoice follow-up marked sent"],
] as const;

const ACTION_KINDS = [
  ["apply_template", "Apply template"],
  ["todo", "Create to-do"],
  ["today", "Today row"],
  ["set_status", "Set job status"],
  ["punch", "Create punch"],
  ["hold", "Hold schedule"],
  ["request_confirmation", "Request confirmation"],
  ["release", "Release schedule"],
  ["schedule_talk", "Schedule toolbox talk"],
  ["set_field", "Set field"],
  ["create_draft_po", "Create draft PO from selection"],
] as const;

const CONDITION_KINDS = [
  ["job_type", "Job type"],
  ["template", "Template"],
  ["pm", "PM"],
  ["cost_code", "Cost code"],
  ["item_name", "Item name"],
  ["amount_over", "Amount over"],
  ["amount_under", "Amount under"],
  ["field", "Field"],
] as const;

type Options = {
  templates: { id: string; name: string }[];
  people: { id: string; name: string }[];
  topics: { id: string; name: string }[];
  fields: { id: string; label: string; recordType: string; fieldType: string }[];
};

function triggerKind(trigger: Trigger | null) {
  return trigger?.kind ?? "job_status";
}

export function AutomationSheet({
  rule,
  options,
  targets,
  preview,
  previewId,
  previewLabel,
}: {
  rule: RuleDraft | null;
  options: Options;
  targets: { id: string; label: string }[];
  preview: string[];
  previewId: string;
  previewLabel: string;
}) {
  const [trigger, setTrigger] = useState<string>(triggerKind(rule?.trigger ?? null));
  const [conditions, setConditions] = useState<Condition[]>(rule?.conditions ?? []);
  const [actions, setActions] = useState<Action[]>(rule?.actions ?? []);
  return (
    <aside data-sheet="automation" className="flex w-full shrink-0 flex-col gap-3 border-l border-[var(--mac-separator)] p-4 md:w-[420px]">
      <ActionForm action={saveAutomationAction} className="flex flex-col gap-3">
        {rule?.id ? <input type="hidden" name="id" value={rule.id} /> : null}
        <input type="hidden" name="enabled" value={rule?.enabled === false ? "0" : "1"} />
        <label className="text-[13px]">
          Name
          <input name="name" aria-label="Name" defaultValue={rule?.name ?? ""} required className="field mt-1" />
        </label>
        <div className="ctl-line">
          <span>When</span>
          <select name="trigger" aria-label="Trigger" className="ctl" value={trigger} onChange={(event) => setTrigger(event.target.value)}>
            {TRIGGERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <TriggerRest trigger={trigger} rule={rule} />
        </div>
        <div className="flex flex-col gap-2">
          <span>If</span>
          {conditions.map((condition, index) => (
            <ConditionRow
              key={`${condition.kind}-${index}`}
              index={index}
              condition={condition}
              options={options}
              onKind={(kind) => setConditions((current) => current.map((item, itemIndex) => (itemIndex === index ? blankCondition(kind) : item)))}
              onRemove={() => setConditions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            />
          ))}
          <button type="button" className="ctl w-fit" onClick={() => setConditions((current) => [...current, { kind: "job_type", value: "" }])}>
            + Add condition
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <span>Then</span>
          {actions.map((action, index) => (
            <ActionRow
              key={`${action.kind}-${index}`}
              index={index}
              action={action}
              options={options}
              onKind={(kind) => setActions((current) => current.map((item, itemIndex) => (itemIndex === index ? blankAction(kind) : item)))}
              onRemove={() => setActions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            />
          ))}
          <button type="button" className="ctl w-fit" onClick={() => setActions((current) => [...current, { kind: "todo", title: "", who: "", dueDays: 0 }])}>
            + Add action
          </button>
        </div>
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
        <form action="/settings/automations" method="get" className="ctl-line">
          <input type="hidden" name="rule" value={rule.id} />
          <span>Preview on</span>
          <select
            name="preview"
            aria-label={previewLabel}
            defaultValue={previewId}
            className="ctl"
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            <option value="">{previewLabel}</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </form>
      ) : null}
      {preview.length > 0 ? (
        <p aria-label="Preview" className="mac-t13">
          {preview.join(" · ")}
        </p>
      ) : null}
    </aside>
  );
}

function TriggerRest({ trigger, rule }: { trigger: string; rule: RuleDraft | null }) {
  if (trigger === "job_status") {
    return (
      <>
        <span>is</span>
        <select name="status" aria-label="Status" defaultValue={rule?.trigger.kind === "job_status" ? rule.trigger.status : "active"} className="ctl">
          <option value="active">Active</option>
          <option value="complete">Complete</option>
        </select>
      </>
    );
  }
  if (trigger === "inspection_result") {
    return (
      <>
        <span>is</span>
        <select name="result" aria-label="Result" defaultValue={rule?.trigger.kind === "inspection_result" ? rule.trigger.result : "failed"} className="ctl">
          <option value="failed">Failed</option>
          <option value="passed">Passed</option>
        </select>
      </>
    );
  }
  if (trigger === "invoice_overdue" || trigger === "vendor_expiring" || trigger === "unconfirmed_before") {
    const days = rule?.trigger.kind === "invoice_overdue" || rule?.trigger.kind === "vendor_expiring" || rule?.trigger.kind === "unconfirmed_before" ? rule.trigger.days : 14;
    return (
      <>
        <span>is</span>
        <input name="days" aria-label="Days" type="number" min={0} max={365} defaultValue={days} className="ctl w-16" />
        <span>days</span>
        {trigger === "vendor_expiring" ? (
          <select name="cert" aria-label="Certificate" defaultValue={rule?.trigger.kind === "vendor_expiring" ? rule.trigger.cert : "insurance"} className="ctl">
            <option value="insurance">Insurance</option>
            <option value="license">License</option>
          </select>
        ) : null}
      </>
    );
  }
  return null;
}

function blankCondition(kind: string): Condition {
  if (kind === "template") return { kind: "template", templateId: "" };
  if (kind === "pm") return { kind: "pm", userId: "" };
  if (kind === "amount_over" || kind === "amount_under") return { kind, cents: 0 };
  if (kind === "cost_code" || kind === "item_name" || kind === "job_type") return { kind, value: "" };
  if (kind === "field") return { kind: "field", fieldId: "", op: "eq", value: "" };
  return { kind: "job_type", value: "" };
}

function blankAction(kind: string): Action {
  if (kind === "apply_template") return { kind: "apply_template", templateId: "" };
  if (kind === "todo") return { kind: "todo", title: "", who: "", dueDays: 0 };
  if (kind === "today") return { kind: "today", title: "", who: "" };
  if (kind === "set_status") return { kind: "set_status", status: "active" };
  if (kind === "punch") return { kind: "punch", title: "" };
  if (kind === "release") return { kind: "release" };
  if (kind === "request_confirmation") return { kind: "request_confirmation" };
  if (kind === "schedule_talk") return { kind: "schedule_talk", topicId: "", withinWorkdays: 2 };
  if (kind === "set_field") return { kind: "set_field", fieldId: "", value: "" };
  return { kind: "hold" };
}

function conditionValue(condition: Condition) {
  if (condition.kind === "template") return condition.templateId;
  if (condition.kind === "pm") return condition.userId;
  if (condition.kind === "amount_over" || condition.kind === "amount_under") return (condition.cents / 100).toFixed(0);
  return condition.value;
}

function ConditionRow({
  index,
  condition,
  options,
  onKind,
  onRemove,
}: {
  index: number;
  condition: Condition;
  options: Options;
  onKind: (kind: string) => void;
  onRemove: () => void;
}) {
  const value = conditionValue(condition);
  return (
    <div className="ctl-line">
      <select name={`c${index}kind`} aria-label={`Condition ${index + 1}`} className="ctl" value={condition.kind} onChange={(event) => onKind(event.target.value)}>
        {CONDITION_KINDS.map(([kind, label]) => (
          <option key={kind} value={kind}>
            {label}
          </option>
        ))}
      </select>
      {condition.kind === "template" ? (
        <select name={`c${index}value`} aria-label={`Value ${index + 1}`} defaultValue={value} className="ctl">
          {options.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      ) : null}
      {condition.kind === "pm" ? (
        <select name={`c${index}value`} aria-label={`Value ${index + 1}`} defaultValue={value} className="ctl">
          {options.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      ) : null}
      {condition.kind === "field" ? (
        <>
          <select name={`c${index}field`} aria-label={`Field ${index + 1}`} defaultValue={condition.fieldId} className="ctl">
            {options.fields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.label}
              </option>
            ))}
          </select>
          <select name={`c${index}op`} aria-label={`Compare ${index + 1}`} defaultValue={condition.op} className="ctl">
            <option value="eq">equals</option>
            <option value="empty">is empty</option>
            <option value="gt">greater than</option>
          </select>
          {condition.op === "empty" ? null : <input name={`c${index}value`} aria-label={`Value ${index + 1}`} defaultValue={condition.value} className="ctl" />}
        </>
      ) : null}
      {condition.kind !== "template" && condition.kind !== "pm" && condition.kind !== "field" ? (
        <input name={`c${index}value`} aria-label={`Value ${index + 1}`} defaultValue={value} className="ctl" />
      ) : null}
      <button type="button" className="ctl icon" aria-label={`Remove condition ${index + 1}`} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

function ActionRow({
  index,
  action,
  options,
  onKind,
  onRemove,
}: {
  index: number;
  action: Action;
  options: Options;
  onKind: (kind: string) => void;
  onRemove: () => void;
}) {
  const who = action.kind === "todo" || action.kind === "today" ? action.who : "";
  const title = action.kind === "todo" || action.kind === "today" || action.kind === "punch" ? action.title : "";
  return (
    <div className="ctl-line">
      <select name={`a${index}kind`} aria-label={`Action ${index + 1}`} className="ctl" value={action.kind} onChange={(event) => onKind(event.target.value)}>
        {ACTION_KINDS.map(([kind, label]) => (
          <option key={kind} value={kind}>
            {label}
          </option>
        ))}
      </select>
      {action.kind === "apply_template" ? (
        <select name={`a${index}template`} aria-label="Template" defaultValue={action.templateId} className="ctl">
          {options.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      ) : null}
      {action.kind === "todo" || action.kind === "today" || action.kind === "punch" ? (
        <input name={`a${index}title`} aria-label={index === 0 ? "Title" : `Title ${index + 1}`} defaultValue={title} className="ctl" />
      ) : null}
      {action.kind === "todo" || action.kind === "today" ? (
        <select name={`a${index}who`} aria-label="Who" defaultValue={who} className="ctl">
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
      {action.kind === "todo" ? <input name={`a${index}days`} aria-label="Due days" type="number" min={0} max={365} defaultValue={action.dueDays} className="ctl w-16" /> : null}
      {action.kind === "set_status" ? (
        <select name={`a${index}status`} aria-label="Job status" defaultValue={action.status} className="ctl">
          <option value="active">Active</option>
          <option value="complete">Complete</option>
        </select>
      ) : null}
      {action.kind === "schedule_talk" ? (
        <>
          <select name={`a${index}topic`} aria-label="Topic" defaultValue={action.topicId} className="ctl">
            {options.topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </select>
          <input name={`a${index}days`} aria-label="Workdays" type="number" min={0} max={365} defaultValue={action.withinWorkdays} className="ctl w-16" />
        </>
      ) : null}
      {action.kind === "set_field" ? (
        <>
          <select name={`a${index}field`} aria-label={`Field ${index + 1}`} defaultValue={action.fieldId} className="ctl">
            {options.fields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.label}
              </option>
            ))}
          </select>
          <input name={`a${index}value`} aria-label={`Value ${index + 1}`} defaultValue={action.value} className="ctl" />
        </>
      ) : null}
      <button type="button" className="ctl icon" aria-label={`Remove action ${index + 1}`} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}
