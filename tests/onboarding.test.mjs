import assert from "node:assert/strict";
import test from "node:test";

import {
  ONBOARDING_TOURS,
  ONBOARDING_VERSION,
  isOnboardingStatus,
  isOnboardingTourKey
} from "../lib/onboarding.ts";

test("mantiene una versión positiva y recorridos únicos", () => {
  assert.ok(ONBOARDING_VERSION > 0);
  assert.equal(new Set(ONBOARDING_TOURS).size, ONBOARDING_TOURS.length);
  assert.deepEqual(ONBOARDING_TOURS, [
    "general",
    "daka",
    "competitors",
    "comparison",
    "opportunities",
    "monitoring"
  ]);
});

test("acepta únicamente recorridos aprobados", () => {
  for (const tour of ONBOARDING_TOURS) assert.equal(isOnboardingTourKey(tour), true);
  assert.equal(isOnboardingTourKey("users"), false);
  assert.equal(isOnboardingTourKey(null), false);
});

test("acepta únicamente estados persistibles", () => {
  for (const status of ["in_progress", "completed", "dismissed", "postponed"]) {
    assert.equal(isOnboardingStatus(status), true);
  }
  assert.equal(isOnboardingStatus("pending"), false);
  assert.equal(isOnboardingStatus(undefined), false);
});
