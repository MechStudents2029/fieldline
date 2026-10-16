export const MEETING_KINDS = ["oac", "sub", "precon", "internal"] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

export const MEETING_STATUSES = ["agenda", "minutes", "approved"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const ITEM_STATUSES = ["open", "closed"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ACTION_STATUSES = ["open", "done"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const PRESENCE = ["present", "absent"] as const;
export type Presence = (typeof PRESENCE)[number];

export const LINK_TYPES = ["rfi", "change_order", "submittal", "selection", "schedule"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export const ASSIGNEE_KINDS = ["user", "vendor", "client"] as const;
export type AssigneeKind = (typeof ASSIGNEE_KINDS)[number];

export const KIND_LABEL: Record<MeetingKind, string> = {
  oac: "OAC",
  sub: "Sub coordination",
  precon: "Pre-con",
  internal: "Internal",
};

export const STATUS_LABEL: Record<MeetingStatus, string> = {
  agenda: "Agenda",
  minutes: "Minutes",
  approved: "Approved",
};

export function isMeetingKind(value: string): value is MeetingKind {
  return (MEETING_KINDS as readonly string[]).includes(value);
}

export function isLinkType(value: string): value is LinkType {
  return (LINK_TYPES as readonly string[]).includes(value);
}

export function sourceLabel(meetingNumber: number): string {
  return `from meeting #${meetingNumber}`;
}

export function nextNumber(previous: number): number {
  return previous + 1;
}

export function canEditMeeting(status: string): boolean {
  return status === "agenda" || status === "minutes";
}

export type CarryItem = {
  id: string;
  title: string;
  notes: string;
  decision: string;
  itemStatus: string;
  linkType: string;
  linkId: string | null;
  sortOrder: number;
};

export type CarryAction = {
  id: string;
  itemId: string;
  title: string;
  assigneeKind: string;
  userId: string | null;
  contactId: string | null;
  dueOn: string | null;
  status: string;
};

export type CarriedItem = {
  title: string;
  notes: string;
  decision: string;
  itemStatus: ItemStatus;
  linkType: string;
  linkId: string | null;
  sortOrder: number;
  carriedFromItemId: string;
  sourceLabel: string;
  actions: {
    title: string;
    assigneeKind: string;
    userId: string | null;
    contactId: string | null;
    dueOn: string | null;
    status: "open";
    carriedFromActionId: string;
    sourceLabel: string;
  }[];
};

/** Open items carry forward. Open actions carry forward, even when the item is closed. Done actions stay behind. */
export function carryForward(items: CarryItem[], actions: CarryAction[], meetingNumber: number): CarriedItem[] {
  const label = sourceLabel(meetingNumber);
  const openByItem = new Map<string, CarryAction[]>();
  for (const action of actions) {
    if (action.status !== "open") continue;
    const list = openByItem.get(action.itemId) ?? [];
    list.push(action);
    openByItem.set(action.itemId, list);
  }
  return items
    .filter((item) => item.itemStatus === "open" || (openByItem.get(item.id)?.length ?? 0) > 0)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, index) => ({
      title: item.title,
      notes: item.notes,
      decision: item.decision,
      itemStatus: item.itemStatus === "closed" ? "closed" : "open",
      linkType: item.linkType,
      linkId: item.linkId,
      sortOrder: index,
      carriedFromItemId: item.id,
      sourceLabel: label,
      actions: (openByItem.get(item.id) ?? []).map((action) => ({
        title: action.title,
        assigneeKind: action.assigneeKind,
        userId: action.userId,
        contactId: action.contactId,
        dueOn: action.dueOn,
        status: "open" as const,
        carriedFromActionId: action.id,
        sourceLabel: label,
      })),
    }));
}
