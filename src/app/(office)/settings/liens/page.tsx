import Link from "next/link";
import { notFound } from "next/navigation";
import { saveLienRuleAction } from "@/app/(office)/liens/actions";
import { ActionForm } from "@/components/action-form";
import { Toolbar } from "@/components/mac/toolbar";
import { requireSession } from "@/lib/auth/session";
import { canSeeMoney } from "@/lib/permissions";
import { lienRulesBoard } from "@/lib/services/liens";
import type { LienRuleSpec } from "@/lib/liens/deadlines";

function kindOptions(kinds: string[]) {
  return kinds.map((kind) => (
    <option key={kind} value={kind}>
      {kind === "month_day" ? "Month day" : kind === "none" ? "None" : kind[0]!.toUpperCase() + kind.slice(1)}
    </option>
  ));
}

function RuleForm({ rule }: { rule: LienRuleSpec & { id: string } }) {
  return (
    <ActionForm action={saveLienRuleAction} className="grid grid-cols-2 gap-2 border-b border-[var(--mac-separator)] py-3">
      <input type="hidden" name="state" value={rule.state} />
      <p className="col-span-2 num">{rule.state}</p>
      <label className="text-sm">
        Role
        <select name="role" aria-label={`Role ${rule.state}`} defaultValue={rule.role} className="field mt-1">
          <option value="prime">Prime</option>
          <option value="sub">Sub</option>
          <option value="supplier">Supplier</option>
        </select>
      </label>
      <label className="text-sm">
        Prelim
        <select name="prelimKind" aria-label={`Prelim ${rule.state}`} defaultValue={rule.prelimKind} className="field mt-1">
          {kindOptions(["none", "calendar", "business", "month_day"])}
        </select>
      </label>
      <label className="text-sm">
        Prelim days
        <input name="prelimDays" aria-label={`Prelim days ${rule.state}`} type="number" min={0} defaultValue={rule.prelimDays} className="field mt-1" />
      </label>
      <label className="text-sm">
        Prelim months
        <input name="prelimMonths" aria-label={`Prelim months ${rule.state}`} type="number" min={0} defaultValue={rule.prelimMonths} className="field mt-1" />
      </label>
      <label className="text-sm">
        Prelim day
        <input name="prelimDay" aria-label={`Prelim day ${rule.state}`} type="number" min={0} max={31} defaultValue={rule.prelimDay} className="field mt-1" />
      </label>
      <label className="text-sm">
        Intent
        <select name="noiKind" aria-label={`Intent ${rule.state}`} defaultValue={rule.noiKind} className="field mt-1">
          {kindOptions(["none", "calendar", "business"])}
        </select>
      </label>
      <label className="text-sm">
        Intent days
        <input name="noiDays" aria-label={`Intent days ${rule.state}`} type="number" min={0} defaultValue={rule.noiDays} className="field mt-1" />
      </label>
      <label className="text-sm">
        Filing
        <select name="fileKind" aria-label={`Filing ${rule.state}`} defaultValue={rule.fileKind} className="field mt-1">
          {kindOptions(["none", "calendar", "business", "month_day"])}
        </select>
      </label>
      <label className="text-sm">
        Anchor
        <select name="fileAnchor" aria-label={`Anchor ${rule.state}`} defaultValue={rule.fileAnchor} className="field mt-1">
          <option value="last">Last</option>
          <option value="completion">Completion</option>
        </select>
      </label>
      <label className="text-sm">
        Filing days
        <input name="fileDays" aria-label={`Filing days ${rule.state}`} type="number" min={0} defaultValue={rule.fileDays} className="field mt-1" />
      </label>
      <label className="text-sm">
        Filing months
        <input name="fileMonths" aria-label={`Filing months ${rule.state}`} type="number" min={0} defaultValue={rule.fileMonths} className="field mt-1" />
      </label>
      <label className="text-sm">
        Filing day
        <input name="fileDay" aria-label={`Filing day ${rule.state}`} type="number" min={0} max={31} defaultValue={rule.fileDay} className="field mt-1" />
      </label>
      <label className="text-sm">
        Enforce
        <select name="enforceKind" aria-label={`Enforce ${rule.state}`} defaultValue={rule.enforceKind} className="field mt-1">
          {kindOptions(["none", "calendar", "business", "anniversary"])}
        </select>
      </label>
      <label className="text-sm">
        From
        <select name="enforceFrom" aria-label={`From ${rule.state}`} defaultValue={rule.enforceFrom} className="field mt-1">
          <option value="filed">Filed</option>
          <option value="file_deadline">Filing deadline</option>
        </select>
      </label>
      <label className="text-sm">
        Enforce days
        <input name="enforceDays" aria-label={`Enforce days ${rule.state}`} type="number" min={0} defaultValue={rule.enforceDays} className="field mt-1" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="prelimLapses" value="1" defaultChecked={rule.prelimLapses} aria-label={`Lapses ${rule.state}`} />
        Lapses
      </label>
      <label className="col-span-2 text-sm">
        Citation
        <input name="citation" aria-label={`Citation ${rule.state}`} defaultValue={rule.citation} className="field mt-1" />
      </label>
      <button type="submit" className="ctl h-9 w-fit">
        Save
      </button>
    </ActionForm>
  );
}

export default async function LienRulesPage() {
  const session = await requireSession();
  if (!canSeeMoney(session.role)) notFound();
  const board = lienRulesBoard(session);
  return (
    <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="hidden md:block">
        <Toolbar title="Lien rules" subtitle={String(board.rules.length)} search={false} leading={<Link href="/settings">‹</Link>} />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-4">
        <h1 className="fl-large-title md:hidden">Lien rules</h1>
        {board.canEdit
          ? board.rules.map((rule) => <RuleForm key={rule.id} rule={rule} />)
          : board.rules.map((rule) => (
              <p key={rule.id} className="num border-b border-[var(--mac-separator)] py-3" data-state={rule.state}>
                {rule.state} · {rule.role} · {rule.citation}
              </p>
            ))}
      </div>
    </div>
  );
}
