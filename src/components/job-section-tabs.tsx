import { Segmented } from "@/components/mac/toolbar";

export function jobSectionTabs(projectId: string, current: "overview" | "budget" | "logs" | "files" | "selections" | "updates" | "permits" | "safety" | "specs" | "meetings" | "handover") {
  const job = `/projects/${projectId}`;
  return (
    <Segmented
      items={[
        { href: `${job}#overview`, label: "Overview", current: current === "overview" },
        { href: `${job}#budget`, label: "Budget", current: current === "budget" },
        { href: `${job}/logs`, label: "Logs", current: current === "logs" },
        { href: `${job}/files`, label: "Files", current: current === "files" },
        { href: `${job}/selections`, label: "Selections", current: current === "selections" },
        { href: `${job}/permits`, label: "Permits", current: current === "permits" },
        { href: `${job}/safety`, label: "Safety", current: current === "safety" },
        { href: `${job}/updates`, label: "Updates", current: current === "updates" },
        { href: `${job}/specs`, label: "Specs", current: current === "specs" },
        { href: `${job}/meetings`, label: "Meetings", current: current === "meetings" },
        { href: `${job}/handover`, label: "Handover", current: current === "handover" },
      ]}
    />
  );
}
