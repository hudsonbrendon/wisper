# i18n Localization Report: Account / Monetization UI

## Languages Translated

All 15 UI languages received 23 new keys each:

| Code | Language | Notes |
|------|----------|-------|
| en | English | Canonical source strings |
| pt | Português (Brazilian) | Provided verbatim per spec |
| es | Español | Natural Spanish; "Actualiza a Pro" for upgrade CTA |
| fr | Français | "Passez à Pro"; "forfait {plan}" for plan badge |
| de | Deutsch | "{plan}-Plan" compound noun; "Upgrade auf Pro" |
| it | Italiano | "piano {plan}"; "Passa a Pro" |
| nl | Nederlands | "{plan}-abonnement" for plan badge |
| ru | Русский | "план {plan}"; Cyrillic throughout |
| pl | Polski | "plan {plan}"; "Przejdź na Pro" |
| tr | Türkçe | "{plan} planı"; "Pro'ya geç" |
| ja | 日本語 | "{plan}プラン"; counted words as "文字数" (characters) |
| ko | 한국어 | "{plan} 플랜"; "Pro로 업그레이드" |
| zh | 中文 (Simplified) | "{plan} 计划"; "升级到 Pro" |
| ar | العربية | RTL; "خطة {plan}"; right-to-left grammar maintained |
| hi | हिन्दी | "{plan} प्लान"; "Pro में अपग्रेड करें" |

## Keys Added (23 total)

- `account.title`, `account.subtitle`, `account.loading`, `account.planBadge`
- `account.wordsThisWeek`, `account.meetingsThisWeek`, `account.unlimited`
- `account.signOut`, `account.continueGoogle`, `account.openingBrowser`
- `upgrade.signInTitle`, `upgrade.signInBody`, `upgrade.limitTitle`
- `upgrade.limitBodyDictation`, `upgrade.limitBodyMeeting`
- `upgrade.perMonth`, `upgrade.perYear`, `upgrade.comingSoon`, `upgrade.notNow`
- `usage.banner`
- `onboarding.login.title`, `onboarding.login.body`, `onboarding.login.signedIn`

## Components Rewired

- `src/routes/Account.tsx` — added `useI18n` import and `const { t } = useI18n()`, replaced all 9 hardcoded strings
- `src/components/UpgradeModal.tsx` — added `useI18n`, replaced 9 strings; limit body now uses conditional key based on `blocked.metric`
- `src/components/UsageBanner.tsx` — added `useI18n`, replaced entire banner sentence with `t("usage.banner", {...})`
- `src/routes/Onboarding.tsx` — added `const { t } = useI18n()` inside `LoginStep`, replaced 4 strings

## Test Changes

- `src/routes/Account.test.tsx`: added `I18nProvider` import; `localStorage.setItem("ui_lang", "en")` in `beforeEach`; all 4 `render(<Account />)` calls wrapped with `<I18nProvider>`
- `src/components/UpgradeModal.test.tsx`: same pattern; 3 `render()` calls wrapped
- `src/components/UsageBanner.test.tsx`: same pattern; 3 `render()` calls wrapped
- `src/routes/Onboarding.login.test.tsx`: 2 `getByRole` button matchers changed from `/continue with google/i` to exact string `"account.continueGoogle"` (since that test mocks `t(k) => k`)

## Strings Noted as Uncertain

- **Japanese `account.wordsThisWeek`**: translated as "今週の文字数" (characters this week) rather than "今週の単語数" because Japanese dictation more naturally counts characters/characters than Western word units. The `usage.banner` key uses "文字" too for consistency.
- **Korean `upgrade.perYear`**: "$72 / 년" — "년" is used for standalone year; some contexts prefer "연" but "년" is more common in number contexts.
- **German `account.planBadge`**: "{plan}-Plan" with hyphen — standard German compound noun formation (e.g., "free-Plan").

## Test Results

- `pnpm test`: 254/254 passed (30 test files)
- `pnpm typecheck`: no errors
