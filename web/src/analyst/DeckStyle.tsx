import { useState } from "react";
import type { DeckTheme } from "./deck";

const KEY = "deckTheme";
export const getDeckTheme = (): DeckTheme => {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" || v === "alternate" ? v : "alternate"; }
  catch { return "alternate"; }
};

/** Slide style for PowerPoint/PDF downloads: light, dark, or alternating dark and soft green. Remembered per browser. */
export function DeckStyle({ value, onChange }: { value: DeckTheme; onChange: (t: DeckTheme) => void }) {
  const opts: [DeckTheme, string][] = [["alternate", "Alternating"], ["dark", "Dark"], ["light", "Light"]];
  return (
    <span className="deck-style" role="group" aria-label="Slide style">
      <span className="muted small">Style</span>
      {opts.map(([k, label]) => (
        <button key={k} type="button" className={value === k ? "on" : ""} aria-pressed={value === k}
          onClick={() => { onChange(k); try { localStorage.setItem(KEY, k); } catch { /* storage blocked */ } }}>
          <i className={"sw " + k} aria-hidden="true" />{label}
        </button>
      ))}
    </span>
  );
}

export function useDeckTheme() {
  return useState<DeckTheme>(getDeckTheme);
}
