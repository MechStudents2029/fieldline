"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const go = { t: "/", l: "/pipeline", j: "/projects", e: "/estimates", h: "/time", b: "/bills", c: "/contacts" } as const;

function typingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function Hotkeys() {
  const router = useRouter();
  useEffect(() => {
    let armed = false;
    let timer = 0;
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (key === "k" || event.code === "KeyK")) {
        event.preventDefault();
        window.dispatchEvent(new Event("fieldline-command"));
        return;
      }
      if (event.metaKey && event.ctrlKey && key === "s") {
        event.preventDefault();
        window.dispatchEvent(new Event("fieldline-sidebar"));
        return;
      }
      if (event.metaKey && event.altKey && event.code === "Digit0") {
        event.preventDefault();
        const root = document.documentElement;
        const wide = window.innerWidth >= 1280;
        const shown = root.classList.contains("mac-inspector-on") || (wide && !root.classList.contains("mac-inspector-off"));
        if (shown) {
          root.classList.add("mac-inspector-off");
          root.classList.remove("mac-inspector-on");
        } else {
          root.classList.remove("mac-inspector-off");
          root.classList.toggle("mac-inspector-on", !wide);
        }
        return;
      }
      if (event.metaKey && event.key === "Enter") {
        const primary = [...document.querySelectorAll<HTMLElement>("[data-mac-primary]")].find((node) => node.offsetParent !== null);
        primary?.click();
        return;
      }
      if (typingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (key === "/") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("[data-mac-search]")?.focus();
        return;
      }
      if (key === "?") {
        window.dispatchEvent(new Event("fieldline-help"));
        return;
      }
      if (key === "n" && event.metaKey) return;
      if (armed && key in go) {
        armed = false;
        router.push(go[key as keyof typeof go]);
        return;
      }
      if (key === "g") {
        armed = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          armed = false;
        }, 800);
      }
    };
    const onNew = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "n" && !typingTarget(event.target)) {
        event.preventDefault();
        const button = [...document.querySelectorAll<HTMLElement>("[data-mac-new]")].find((node) => node.offsetParent !== null);
        if (button) button.click();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onNew, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onNew, true);
      window.clearTimeout(timer);
    };
  }, [router]);
  return null;
}
