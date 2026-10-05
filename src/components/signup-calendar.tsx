"use client";

import { useState, useSyncExternalStore } from "react";
import { DEFAULT_TIME_ZONE, DEFAULT_WEEK_START, WEEKDAY_NAMES, isValidTimeZone } from "@/lib/time/calendar";

const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [DEFAULT_TIME_ZONE];

function subscribe() {
  return () => {};
}

function browserTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
}

export function SignupCalendarFields() {
  const detected = useSyncExternalStore(subscribe, browserTimeZone, () => DEFAULT_TIME_ZONE);
  const [chosen, setChosen] = useState<string | null>(null);
  const timeZone = chosen ?? detected;
  const options = zones.includes(timeZone) ? zones : [timeZone, ...zones];

  return (
    <>
      <label className="text-sm">
        Time zone
        <select name="timeZone" value={timeZone} onChange={(event) => setChosen(event.target.value)} className="field mt-1">
          {options.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">Days and weeks follow this clock. It starts as this browser’s zone, then you can change it.</p>
      <label className="text-sm">
        Week starts
        <select name="weekStartsOn" defaultValue={String(DEFAULT_WEEK_START)} className="field mt-1">
          {WEEKDAY_NAMES.map((name, index) => (
            <option key={name} value={index}>
              {name} — seven days from {name} morning
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">Monday is the default. The week starts at midnight in the time zone above.</p>
    </>
  );
}
