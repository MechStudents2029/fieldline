"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SignaturePad } from "@/components/signature-pad";
import { completeTalkAction } from "@/app/(office)/safety/actions";
import { enqueueToolbox } from "@/lib/offline/browser";

export function TalkSignForm({
  talkId,
  projectId,
  crew,
  scope,
}: {
  talkId: string;
  projectId: string;
  crew: { id: string; name: string }[];
  scope: { orgId: string; userId: string };
}) {
  const [saved, setSaved] = useState("");
  return (
    <ActionForm
      action={completeTalkAction.bind(null, talkId)}
      className="flex flex-col gap-4"
      dataSheet="talk"
      onSubmit={(event) => {
        if (typeof navigator !== "undefined" && navigator.onLine) return;
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const attendees = [];
        for (const userId of data.getAll("user").map(String)) {
          const drawn = String(data.get(`sign_${userId}`) || "");
          if (!drawn) continue;
          attendees.push({ userId, visitorName: "", typedName: String(data.get(`typed_${userId}`) || ""), drawnDataUrl: drawn });
        }
        const visitorName = String(data.get("visitorName") || "").trim();
        const visitorSign = String(data.get("sign_visitor") || "");
        if (visitorName && visitorSign) attendees.push({ userId: "", visitorName, typedName: visitorName, drawnDataUrl: visitorSign });
        void enqueueToolbox(scope, { projectId, talkId, attendees }).then(() => setSaved("Saved on this phone"));
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      {crew.map((person) => (
        <div key={person.id}>
          <input type="hidden" name="user" value={person.id} />
          <input type="hidden" name={`typed_${person.id}`} value={person.name} />
          <p className="mac-t13">{person.name}</p>
          <SignaturePad name={`sign_${person.id}`} label={`Sign ${person.name}`} />
        </div>
      ))}
      <label className="text-[13px]">
        Visitor
        <input name="visitorName" aria-label="Visitor" className="field mt-1" />
      </label>
      <SignaturePad name="sign_visitor" label="Sign visitor" />
      <button type="submit" className="mac-primary w-fit">
        Complete
      </button>
      {saved ? <p className="mac-t13">{saved}</p> : null}
    </ActionForm>
  );
}
