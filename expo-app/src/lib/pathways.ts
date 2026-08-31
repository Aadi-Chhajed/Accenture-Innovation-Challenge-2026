// Mirrors the pathway keys in routing.ts's pathwayResources map.
export const pathways = [
  "Resuscitation / Critical Care Bay",
  "Cardiac Review",
  "Stroke / Neuro Review",
  "Trauma",
  "Pediatrics",
  "Obstetrics",
  "Isolation / Infection Concern",
  "Emergency General",
  "Observation",
  "Fast Track / Minor Care",
];

// Single source of truth is SYMPTOM_TAXONOMY in prompts.ts, so the chips the
// nurse sees and the vocabulary the model is given can never drift apart.
export { SYMPTOM_TAXONOMY as symptomOptions } from "./prompts";
