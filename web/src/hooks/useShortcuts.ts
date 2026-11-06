import { useEffect } from "react";

// Window-level keydown listener that ignores keystrokes typed into fields.
export function useShortcuts(handler: (e: KeyboardEvent) => void) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing && e.key !== "Escape") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      handler(e);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [handler]);
}
