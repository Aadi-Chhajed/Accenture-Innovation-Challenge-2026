import type { UrgencyLevel } from "./types";

// Literal className strings (not template-built) so NativeWind's content scan picks them all up.
export const urgencyStyles: Record<
  UrgencyLevel,
  { bar: string; bgSoft: string; text: string; label: string; hex: string }
> = {
  1: { bar: "bg-urgency-1", bgSoft: "bg-urgency-1/10", text: "text-urgency-1", label: "CRITICAL", hex: "#ba1a1a" },
  2: { bar: "bg-urgency-2", bgSoft: "bg-urgency-2/10", text: "text-urgency-2", label: "HIGH", hex: "#c2410c" },
  3: { bar: "bg-urgency-3", bgSoft: "bg-urgency-3/10", text: "text-urgency-3", label: "MODERATE", hex: "#b45309" },
  4: { bar: "bg-urgency-4", bgSoft: "bg-urgency-4/10", text: "text-urgency-4", label: "ROUTINE", hex: "#2563eb" },
  5: { bar: "bg-urgency-5", bgSoft: "bg-urgency-5/10", text: "text-urgency-5", label: "LOW", hex: "#16a34a" },
};

export function initials(name: string): string {
  // Tokens are stripped of punctuation first so an id like "NUR-1042" or a wrapped
  // name like "Nurse (NUR-1042)" can't yield junk initials such as "N(".
  const parts = name
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);

  if (parts.length === 0) return "?";
  // Single token (a roll number, a mononym): take its first two characters.
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Age for display. `-1` is the sentinel for "not recorded" — used by Gate 0
 * arrivals, where guessing a number would silently apply that age group's vital
 * thresholds. It must never reach the screen as "-1".
 */
export function ageLabel(age: number): string {
  return age >= 0 ? String(age) : "age unknown";
}
