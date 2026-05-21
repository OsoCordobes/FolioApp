"use client";

import {
  MOOD_IDS,
  MOOD_LABELS,
  MOOD_TAGLINES,
} from "./moods";
import type { CardMood } from "./public-card";

/**
 * Folio · <MoodPicker>
 *
 * 4-card radio group used at Onboarding Step 4 ("Identidad visual") to
 * select the card_mood persisted on the organization. Each card shows a
 * mini-tile hinting at the mood's actual surface treatment (gradient /
 * flat / radial / paper-noise).
 *
 * ARIA: role="radiogroup" + role="radio" on each card with aria-checked
 * for the active mood. Keyboard activation handled by the native button
 * element (Enter / Space).
 *
 * Motion: pc-mood-card-select beat (scale 1.00 → 0.97 → 1.02 → 1.00, 480 ms
 * spring-snap) on the active card. Reduce-motion strips the bounce.
 */

export interface MoodPickerProps {
  value: CardMood;
  onChange: (id: CardMood) => void;
  /** When true, all radios are disabled (e.g. while persisting). */
  disabled?: boolean;
}

export function MoodPicker({ value, onChange, disabled }: MoodPickerProps) {
  return (
    <div
      className="fpc-mood-picker"
      role="radiogroup"
      aria-label="Estilo visual de tu card"
    >
      {MOOD_IDS.map((id) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={`fpc-mood-card ${active ? "is-active" : ""}`.trim()}
            onClick={() => onChange(id)}
          >
            <span className="fpc-mood-mini" data-card-mood={id} aria-hidden />
            <span className="fpc-mood-label">{MOOD_LABELS[id]}</span>
            <span className="fpc-mood-tag">{MOOD_TAGLINES[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
