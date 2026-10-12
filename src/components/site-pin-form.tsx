"use client";

import { useActionState } from "react";
import { adoptSitePinAction, sitePinAction, type ActionState } from "@/app/actions";

export function SitePinForm({
  projectId,
  lat,
  lng,
  radius,
  unit,
  punches,
}: {
  projectId: string;
  lat: string;
  lng: string;
  radius: string;
  unit: "ft" | "m";
  punches: { id: string; label: string }[];
}) {
  const save = sitePinAction.bind(null, projectId);
  const adopt = adoptSitePinAction.bind(null, projectId);
  const [saved, saveAction, saving] = useActionState(save, null);
  const [adopted, adoptAction, adopting] = useActionState(adopt, null);
  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="mac-t11 font-semibold text-[var(--mac-secondary)]">Site pin</p>
      <form action={saveAction} className="flex flex-col gap-2">
        <label className="mac-t13">
          Latitude
          <input name="lat" aria-label="Latitude" inputMode="decimal" defaultValue={lat} required className="ctl mt-1 num" />
        </label>
        <label className="mac-t13">
          Longitude
          <input name="lng" aria-label="Longitude" inputMode="decimal" defaultValue={lng} required className="ctl mt-1 num" />
        </label>
        <label className="mac-t13">
          Radius {unit}
          <input name="radius" aria-label="Radius" inputMode="decimal" defaultValue={radius} placeholder="Company" className="ctl mt-1 num" />
        </label>
        <span className="flex gap-2">
          <button type="button" className="mac-glass-btn" onClick={(event) => useHere(event.currentTarget.form)}>
            Use my location
          </button>
          <button type="submit" className="mac-glass-btn" disabled={saving}>
            Save pin
          </button>
        </span>
        <Note state={saved} />
      </form>
      {punches.length > 0 ? (
        <form action={adoptAction} className="flex items-end gap-2">
          <label className="mac-t13">
            Clock-in
            <select name="entryId" aria-label="Clock-in" className="ctl mt-1" defaultValue={punches[0]?.id}>
              {punches.map((punch) => (
                <option key={punch.id} value={punch.id}>
                  {punch.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="mac-glass-btn" disabled={adopting}>
            Use clock-in
          </button>
          <Note state={adopted} />
        </form>
      ) : null}
    </div>
  );
}

function useHere(form: HTMLFormElement | null) {
  if (!form || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = form.elements.namedItem("lat");
      const lng = form.elements.namedItem("lng");
      if (lat instanceof HTMLInputElement) lat.value = position.coords.latitude.toFixed(6);
      if (lng instanceof HTMLInputElement) lng.value = position.coords.longitude.toFixed(6);
    },
    () => undefined,
    { enableHighAccuracy: false, maximumAge: 0, timeout: 4000 },
  );
}

function Note({ state }: { state: ActionState }) {
  if (state?.error) return <p role="alert" className="mac-t11 text-[var(--mac-danger)]">{state.error}</p>;
  if (state?.ok) return <p role="status" className="mac-t11">{state.ok}</p>;
  return null;
}
