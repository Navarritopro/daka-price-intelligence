export const ONBOARDING_VERSION = 1;

export const ONBOARDING_TOURS = [
  "general",
  "daka",
  "competitors",
  "comparison",
  "opportunities",
  "monitoring"
] as const;

export type OnboardingTourKey = (typeof ONBOARDING_TOURS)[number];
export type OnboardingStatus = "in_progress" | "completed" | "dismissed" | "postponed";

export function isOnboardingTourKey(value: unknown): value is OnboardingTourKey {
  return typeof value === "string" && (ONBOARDING_TOURS as readonly string[]).includes(value);
}

export function isOnboardingStatus(value: unknown): value is OnboardingStatus {
  return value === "in_progress" || value === "completed" || value === "dismissed" || value === "postponed";
}
