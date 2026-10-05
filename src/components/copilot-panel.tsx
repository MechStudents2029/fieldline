import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

export type CopilotAnswer = {
  tool: string | null;
  answer: string;
  rows: { label: string; amountCents: number | null; detail: string }[];
};

const prompts = ["Who owes me money?", "Which jobs are under 20% margin?", "Which cost codes are over budget?", "What's my pipeline value?", "Which proposals are unsigned?", "What happened on Okonkwo yesterday?"];

export function CopilotPanel({ question, result }: { question: string; result: CopilotAnswer | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <Link key={prompt} href={`/copilot?q=${encodeURIComponent(prompt)}`} className="rounded-full bg-muted px-3 py-2 text-left text-xs">
            {prompt}
          </Link>
        ))}
      </div>
      <form method="get" className="flex flex-col gap-2 sm:flex-row">
        <input name="q" className="field" defaultValue={question} aria-label="Ask your business" required />
        <Button type="submit" className="h-11">
          Ask
        </Button>
      </form>
      {result ? (
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{result.tool ?? "no tool"}</p>
          <p className="mt-1 font-heading text-2xl">{result.answer}</p>
          {result.rows.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No rows for that question. The records this company has do not match it.</p>
          ) : null}
          <ul className="mt-4 divide-y divide-border">
            {result.rows.map((row) => (
              <li key={`${row.label}-${row.detail}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{row.label}</span>
                  <span className="block text-xs text-muted-foreground">{row.detail}</span>
                </span>
                <span>{row.amountCents == null ? "—" : formatMoney(row.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Answers use the same numbers as the rest of the app. This version is read-only.</p>
      )}
    </div>
  );
}
