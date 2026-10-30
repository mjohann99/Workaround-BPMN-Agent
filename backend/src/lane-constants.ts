// The "Unassigned" band is drawn by the renderer; it is never a model lane.
export const UNASSIGNED_LANE_ID =
  "Lane_unassigned_band";

export const UNASSIGNED_LANE_NAME =
  "Unassigned";

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True for names that would be confused with the system fallback band. */
export function isFallbackLaneName(
  name: string
): boolean {
  return normalize(name) === normalize(UNASSIGNED_LANE_NAME);
}
