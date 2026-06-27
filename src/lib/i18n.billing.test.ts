import { describe, it, expect } from "vitest";
import { DICTS, LANGS } from "./i18n";

const KEYS = [
  "billing.heading",
  "billing.monthly",
  "billing.annual",
  "billing.perMonth",
  "billing.perYear",
  "billing.saveAnnual",
  "billing.upgradeMonthly",
  "billing.upgradeAnnual",
  "billing.exploreFeatures",
  "billing.manageSubscription",
  "billing.cancelsOn",
  "billing.renewsOn",
  "billing.opening",
  "billing.freeFeatures",
  "billing.proFeatures",
];

describe("billing i18n", () => {
  it("defines every billing key in all languages", () => {
    for (const lang of LANGS) {
      for (const key of KEYS) {
        expect(DICTS[lang][key], `${lang}/${key}`).toBeTruthy();
      }
    }
  });

  it("preserves the {date} placeholder in cancelsOn/renewsOn everywhere", () => {
    for (const lang of LANGS) {
      expect(DICTS[lang]["billing.cancelsOn"]).toContain("{date}");
      expect(DICTS[lang]["billing.renewsOn"]).toContain("{date}");
    }
  });
});
