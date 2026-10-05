export type CopilotTool = "receivables" | "job_margins" | "pipeline" | "overdue_proposals" | "job_log";

export function routeCopilotQuestion(question: string): CopilotTool | null {
  const q = question.toLowerCase();
  if (/what happened on\s+.+\s+yesterday/.test(q)) return "job_log";
  if (/who owes|owe me|receivable|unpaid|outstanding/.test(q)) return "receivables";
  if (/margin|under\s+\d+|losing|over budget|job cost/.test(q)) return "job_margins";
  if (/pipeline|lead value|in the funnel|open deals/.test(q)) return "pipeline";
  if (/overdue|unsigned|not signed|proposal/.test(q)) return "overdue_proposals";
  return null;
}

export function marginThresholdFromQuestion(question: string, fallbackBps: number): number {
  const match = question.match(/under\s+(\d+(?:\.\d+)?)\s*%/);
  if (!match) return fallbackBps;
  return Math.round(Number(match[1]) * 100);
}
