import { Segmented } from "@/components/mac/toolbar";

export function jobSectionTabs(projectId: string, current: "overview" | "budget" | "logs" | "files" | "selections") {
  const job = `/projects/${projectId}`;
  return (
    <Segmented
      items={[
        { href: `${job}#overview`, label: "Overview", current: current === "overview" },
        { href: `${job}#budget`, label: "Budget", current: current === "budget" },
        { href: `${job}/logs`, label: "Logs", current: current === "logs" },
        { href: `${job}/files`, label: "Files", current: current === "files" },
        { href: `${job}/selections`, label: "Selections", current: current === "selections" },
      ]}
    />
  );
}
