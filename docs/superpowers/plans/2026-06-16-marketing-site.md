# OpenWispr Marketing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a modern, interactive landing page for OpenWispr that auto-detects the visitor's OS (and macOS CPU arch via WebGL) to surface the correct download, and deploy it to GitHub Pages.

**Architecture:** A standalone Vite + React + TypeScript + Tailwind v4 app under `site/` (separate pnpm project, isolated from the desktop app). Pure functions (`os.ts`, `releases.ts`) hold all detection + URL logic and are unit-tested with Vitest; React components consume them. A GitHub Actions workflow builds `site/` and deploys the static output to GitHub Pages on every push to `main`.

**Tech Stack:** Vite 7, React 19, TypeScript 6, Tailwind CSS v4 (`@tailwindcss/postcss`), Vitest + Testing Library, GitHub Actions (`actions/deploy-pages`).

---

## Conventions & Facts (read before starting)

- **Repo:** `hudsonbrendon/openwispr`. **Pages URL:** `https://hudsonbrendon.github.io/openwispr/` → Vite `base` MUST be `/openwispr/`.
- **Current release tag:** `v1.0.0`. Release asset filenames (exact, version-embedded):
  - macOS Apple Silicon: `OpenWispr_1.0.0_aarch64.dmg`
  - macOS Intel: `OpenWispr_1.0.0_x64.dmg`
  - Windows: `OpenWispr_1.0.0_x64-setup.exe`
  - Linux AppImage: `OpenWispr_1.0.0_amd64.AppImage`
  - Linux deb: `OpenWispr_1.0.0_amd64.deb`
- **Download URL pattern:** `https://github.com/hudsonbrendon/openwispr/releases/download/v<VERSION>/<asset>`. A single `VERSION` constant drives all URLs; bump it when cutting a new release.
- **Brand palette (from the app):** warm grays `stone-*` (primary), `emerald-*` (accent/CTA), `zinc-*` (dark overlay surfaces). These are all default Tailwind palettes — no custom theme tokens required.
- **Logo:** `assets/logo.png` (824 KB) — copy into `site/public/logo.png`.
- **macOS arch detection:** the browser does NOT expose ARM vs Intel via `navigator`. Use the WebGL `WEBGL_debug_renderer_info` → `UNMASKED_RENDERER_WEBGL` string heuristic (`"Apple"` → Apple Silicon; `"Intel"/"AMD"/"Radeon"` → Intel). Always show the alternate arch as a secondary link so a wrong guess is recoverable.
- **Isolation:** `site/` is its own pnpm project with its own `node_modules`, configs, and tests. The root project's `eslint .`, `prettier --check .`, and `vitest` MUST be told to ignore `site/` (Task 8) so root CI stays green.
- The root `tsconfig.json` only `include`s `src`, so the root `tsc` will not see `site/` — no action needed there.

## File Structure

```
site/
  package.json            # standalone deps + scripts (dev/build/test/lint/format)
  tsconfig.json           # app TS config (mirrors root, include: ["src"])
  tsconfig.node.json      # config-file TS (vite/vitest configs)
  vite.config.ts          # react plugin + base:'/openwispr/' + vitest config
  postcss.config.js       # @tailwindcss/postcss
  index.html              # root HTML, mounts #root
  eslint.config.js        # standalone flat config
  .prettierignore         # ignore dist
  public/
    logo.png              # copied from ../assets/logo.png
  src/
    main.tsx              # React entry, imports index.css
    index.css             # @import "tailwindcss"
    vite-env.d.ts         # vite client types
    App.tsx               # page composition
    test/
      setup.ts            # jest-dom matchers
    lib/
      releases.ts         # VERSION, ASSETS, downloadUrl, allDownloads, pickPrimary
      releases.test.ts
      os.ts               # OS + MacArch types, osFromUA, macArchFromRenderer, detectOS, detectMacArch
      os.test.ts
    components/
      DownloadButton.tsx  # OS-aware primary CTA + "all platforms" list
      DownloadButton.test.tsx
      Hero.tsx            # logo + headline + DownloadButton + pill mock
      Features.tsx        # feature grid
      HowItWorks.tsx      # 3-step strip
      Footer.tsx          # links

.github/workflows/pages.yml  # build site/ + deploy to Pages
```

---

## Task 1: Scaffold the standalone `site/` Vite project

**Files:**
- Create: `site/package.json`
- Create: `site/tsconfig.json`
- Create: `site/tsconfig.node.json`
- Create: `site/vite.config.ts`
- Create: `site/postcss.config.js`
- Create: `site/index.html`
- Create: `site/eslint.config.js`
- Create: `site/.prettierignore`
- Create: `site/.gitignore`
- Create: `site/src/main.tsx`
- Create: `site/src/index.css`
- Create: `site/src/vite-env.d.ts`
- Create: `site/src/App.tsx` (placeholder, replaced in Task 7)
- Create: `site/src/test/setup.ts`

- [ ] **Step 1: Create `site/package.json`**

```json
{
  "name": "openwispr-site",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "lint": "eslint .",
    "format:check": "prettier --check ."
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@tailwindcss/postcss": "^4.3.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@vitejs/plugin-react": "^5.2.0",
    "eslint": "^10.5.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.3",
    "globals": "^17.6.0",
    "jsdom": "^29.1.1",
    "postcss": "^8.5.15",
    "prettier": "^3.8.4",
    "tailwindcss": "^4.3.1",
    "typescript": "~6.0.3",
    "typescript-eslint": "^8.61.1",
    "vite": "^7.0.4",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 2: Create `site/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Create `site/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `site/vite.config.ts`** (base path is critical for project Pages)

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Project Pages serve from /<repo>/, so all asset URLs must be prefixed.
export default defineConfig({
  base: "/openwispr/",
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
```

- [ ] **Step 5: Create `site/postcss.config.js`**

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 6: Create `site/index.html`**

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/openwispr/logo.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenWispr — Local-first voice dictation</title>
    <meta
      name="description"
      content="OpenWispr is a private, local-first voice dictation app. Press a hotkey, speak, and your words appear in any app. Free and open source."
    />
    <meta property="og:title" content="OpenWispr — Local-first voice dictation" />
    <meta
      property="og:description"
      content="Press a hotkey, speak, and your words appear anywhere. 100% local, free and open source."
    />
    <meta property="og:image" content="https://hudsonbrendon.github.io/openwispr/logo.png" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `site/src/index.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 8: Create `site/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 9: Create `site/src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 10: Create `site/src/App.tsx`** (temporary placeholder; replaced in Task 7)

```tsx
export default function App() {
  return <div>OpenWispr</div>;
}
```

- [ ] **Step 11: Create `site/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 12: Create `site/eslint.config.js`**

```js
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist", "**/*.config.js"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
```

- [ ] **Step 13: Create `site/.prettierignore`**

```
dist
pnpm-lock.yaml
```

- [ ] **Step 14: Create `site/.gitignore`**

```
node_modules
dist
```

- [ ] **Step 15: Install deps and verify dev build works**

Run: `cd site && pnpm install`
Expected: resolves and writes `site/pnpm-lock.yaml`, no errors.

Run: `cd site && pnpm build`
Expected: `tsc` passes, `vite build` emits `site/dist/index.html` + `dist/assets/*`. Output ends with `✓ built in ...`.

- [ ] **Step 16: Commit**

```bash
git add site/
git commit -m "chore(site): scaffold Vite + React + Tailwind v4 landing project"
```

---

## Task 2: Release metadata + download URL logic (`releases.ts`)

**Files:**
- Create: `site/src/lib/releases.ts`
- Test: `site/src/lib/releases.test.ts`

- [ ] **Step 1: Write the failing test**

Create `site/src/lib/releases.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  VERSION,
  REPO,
  downloadUrl,
  allDownloads,
  pickPrimary,
} from "./releases";

describe("downloadUrl", () => {
  it("builds a tag-pinned release asset URL", () => {
    expect(downloadUrl("OpenWispr_1.0.0_x64.dmg")).toBe(
      `https://github.com/${REPO}/releases/download/v${VERSION}/OpenWispr_1.0.0_x64.dmg`,
    );
  });
});

describe("pickPrimary", () => {
  it("picks Apple Silicon dmg for mac + apple", () => {
    const d = pickPrimary("mac", "apple");
    expect(d.url).toContain("aarch64.dmg");
    expect(d.label).toMatch(/apple silicon/i);
  });
  it("picks Intel dmg for mac + intel", () => {
    const d = pickPrimary("mac", "intel");
    expect(d.url).toContain("x64.dmg");
    expect(d.label).toMatch(/intel/i);
  });
  it("defaults mac + unknown arch to Apple Silicon", () => {
    expect(pickPrimary("mac", "unknown").url).toContain("aarch64.dmg");
  });
  it("picks the exe for windows", () => {
    expect(pickPrimary("windows", "unknown").url).toContain("x64-setup.exe");
  });
  it("picks the AppImage for linux", () => {
    expect(pickPrimary("linux", "unknown").url).toContain(".AppImage");
  });
  it("falls back to the releases page for unknown OS", () => {
    expect(pickPrimary("unknown", "unknown").url).toContain("/releases/latest");
  });
});

describe("allDownloads", () => {
  it("lists every platform asset", () => {
    const labels = allDownloads().map((d) => d.label);
    expect(labels).toHaveLength(5);
    expect(allDownloads().every((d) => d.url.startsWith("https://"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd site && pnpm test src/lib/releases.test.ts`
Expected: FAIL — "Failed to resolve import './releases'".

- [ ] **Step 3: Write the implementation**

Create `site/src/lib/releases.ts`:

```ts
import type { MacArch, OS } from "./os";

export const REPO = "hudsonbrendon/openwispr";
export const VERSION = "1.0.0";

/** Exact release asset filenames for VERSION. Bump VERSION when re-releasing. */
export const ASSETS = {
  macApple: `OpenWispr_${VERSION}_aarch64.dmg`,
  macIntel: `OpenWispr_${VERSION}_x64.dmg`,
  windows: `OpenWispr_${VERSION}_x64-setup.exe`,
  linuxAppImage: `OpenWispr_${VERSION}_amd64.AppImage`,
  linuxDeb: `OpenWispr_${VERSION}_amd64.deb`,
} as const;

export type Download = { label: string; url: string };

export function downloadUrl(asset: string): string {
  return `https://github.com/${REPO}/releases/download/v${VERSION}/${asset}`;
}

/** Full platform list, used for the "all platforms" secondary section. */
export function allDownloads(): Download[] {
  return [
    { label: "macOS · Apple Silicon (.dmg)", url: downloadUrl(ASSETS.macApple) },
    { label: "macOS · Intel (.dmg)", url: downloadUrl(ASSETS.macIntel) },
    { label: "Windows (.exe)", url: downloadUrl(ASSETS.windows) },
    { label: "Linux (.AppImage)", url: downloadUrl(ASSETS.linuxAppImage) },
    { label: "Linux (.deb)", url: downloadUrl(ASSETS.linuxDeb) },
  ];
}

/** The single best download for the detected platform. */
export function pickPrimary(os: OS, macArch: MacArch): Download {
  if (os === "mac") {
    return macArch === "intel"
      ? { label: "Download for macOS (Intel)", url: downloadUrl(ASSETS.macIntel) }
      : {
          label: "Download for macOS (Apple Silicon)",
          url: downloadUrl(ASSETS.macApple),
        };
  }
  if (os === "windows") {
    return { label: "Download for Windows", url: downloadUrl(ASSETS.windows) };
  }
  if (os === "linux") {
    return { label: "Download for Linux", url: downloadUrl(ASSETS.linuxAppImage) };
  }
  return {
    label: "Download OpenWispr",
    url: `https://github.com/${REPO}/releases/latest`,
  };
}
```

> Note: `os.ts` (Task 3) defines the `OS` and `MacArch` types this file imports. Implement Task 3 in the same session; the type-only import does not run at test time, but `tsc` in `pnpm build` needs it. If running `releases.test.ts` standalone before Task 3, Vitest still passes (types are erased) — but do Task 3 before the next `pnpm build`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd site && pnpm test src/lib/releases.test.ts`
Expected: PASS — 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/releases.ts site/src/lib/releases.test.ts
git commit -m "feat(site): add release metadata and download URL helpers"
```

---

## Task 3: OS + macOS arch detection (`os.ts`)

**Files:**
- Create: `site/src/lib/os.ts`
- Test: `site/src/lib/os.test.ts`

- [ ] **Step 1: Write the failing test**

Create `site/src/lib/os.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { osFromUA, macArchFromRenderer } from "./os";

describe("osFromUA", () => {
  it("detects macOS", () => {
    expect(
      osFromUA(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "MacIntel",
      ),
    ).toBe("mac");
  });
  it("detects iPadOS as mac", () => {
    expect(osFromUA("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "iPad")).toBe(
      "mac",
    );
  });
  it("detects Windows", () => {
    expect(
      osFromUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32"),
    ).toBe("windows");
  });
  it("detects Linux", () => {
    expect(osFromUA("Mozilla/5.0 (X11; Ubuntu; Linux x86_64)", "Linux x86_64")).toBe(
      "linux",
    );
  });
  it("returns unknown for unrecognized agents", () => {
    expect(osFromUA("SomeBot/1.0", "")).toBe("unknown");
  });
});

describe("macArchFromRenderer", () => {
  it("maps Apple GPU strings to apple", () => {
    expect(macArchFromRenderer("Apple M2")).toBe("apple");
    expect(macArchFromRenderer("ANGLE (Apple, Apple M1 Pro, OpenGL)")).toBe(
      "apple",
    );
  });
  it("maps Intel/AMD strings to intel", () => {
    expect(macArchFromRenderer("Intel(R) Iris(TM) Plus Graphics")).toBe("intel");
    expect(macArchFromRenderer("AMD Radeon Pro 5500M")).toBe("intel");
  });
  it("returns unknown for empty or unrecognized renderers", () => {
    expect(macArchFromRenderer("")).toBe("unknown");
    expect(macArchFromRenderer("Mali-G78")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd site && pnpm test src/lib/os.test.ts`
Expected: FAIL — "Failed to resolve import './os'".

- [ ] **Step 3: Write the implementation**

Create `site/src/lib/os.ts`:

```ts
export type OS = "mac" | "windows" | "linux" | "unknown";
export type MacArch = "apple" | "intel" | "unknown";

/** Pure OS classifier from a UA string + optional platform hint. */
export function osFromUA(ua: string, platform = ""): OS {
  const s = `${platform} ${ua}`.toLowerCase();
  if (/mac|iphone|ipad|ipod/.test(s)) return "mac";
  if (/win/.test(s)) return "windows";
  if (/linux|x11|ubuntu|fedora|debian/.test(s)) return "linux";
  return "unknown";
}

/** Pure arch classifier from a WebGL UNMASKED_RENDERER_WEBGL string. */
export function macArchFromRenderer(renderer: string): MacArch {
  const r = renderer.toLowerCase();
  if (r.includes("apple")) return "apple";
  if (r.includes("intel") || r.includes("amd") || r.includes("radeon")) {
    return "intel";
  }
  return "unknown";
}

/** Detect the current OS from the live navigator. */
export function detectOS(): OS {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
  return osFromUA(navigator.userAgent, platform);
}

/**
 * Best-effort macOS CPU arch via the WebGL renderer string. The browser does
 * not expose ARM vs Intel directly, so we read the GPU name: Apple Silicon
 * Macs report an "Apple" GPU; Intel Macs report Intel/AMD. Returns "unknown"
 * when WebGL or the debug extension is unavailable.
 */
export function detectMacArch(): MacArch {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "unknown";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "unknown";
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
    return macArchFromRenderer(renderer ?? "");
  } catch {
    return "unknown";
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd site && pnpm test src/lib/os.test.ts`
Expected: PASS — 8 tests green.

- [ ] **Step 5: Verify the type-only import in releases.ts now resolves**

Run: `cd site && pnpm build`
Expected: `tsc` passes (the `import type { MacArch, OS }` in `releases.ts` resolves), `vite build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/os.ts site/src/lib/os.test.ts
git commit -m "feat(site): add OS and macOS arch detection"
```

---

## Task 4: `DownloadButton` component

**Files:**
- Create: `site/src/components/DownloadButton.tsx`
- Test: `site/src/components/DownloadButton.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `site/src/components/DownloadButton.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DownloadButton from "./DownloadButton";

describe("DownloadButton", () => {
  it("renders the primary CTA for the given platform", () => {
    render(<DownloadButton os="windows" macArch="unknown" />);
    const cta = screen.getByRole("link", { name: /download for windows/i });
    expect(cta).toHaveAttribute("href", expect.stringContaining("x64-setup.exe"));
  });

  it("shows the macOS Apple Silicon CTA and lists all platforms", () => {
    render(<DownloadButton os="mac" macArch="apple" />);
    expect(
      screen.getByRole("link", { name: /download for macOS \(Apple Silicon\)/i }),
    ).toBeInTheDocument();
    // The "all platforms" disclosure lists every asset (5 of them).
    expect(
      screen.getByRole("link", { name: /Windows \(.exe\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Linux \(.deb\)/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd site && pnpm test src/components/DownloadButton.test.tsx`
Expected: FAIL — "Failed to resolve import './DownloadButton'".

- [ ] **Step 3: Write the implementation**

Create `site/src/components/DownloadButton.tsx`:

```tsx
import type { MacArch, OS } from "../lib/os";
import { allDownloads, pickPrimary } from "../lib/releases";

/// OS-aware download CTA. The primary button reflects the detected platform;
/// a static list below offers every platform for manual selection.
export default function DownloadButton({
  os,
  macArch,
}: {
  os: OS;
  macArch: MacArch;
}) {
  const primary = pickPrimary(os, macArch);
  const all = allDownloads();

  return (
    <div className="flex flex-col items-center gap-4">
      <a
        href={primary.url}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:-translate-y-0.5 hover:bg-emerald-500"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {primary.label}
      </a>

      <details className="group text-center">
        <summary className="cursor-pointer list-none text-sm text-stone-400 underline-offset-4 hover:text-stone-200 hover:underline">
          All platforms &amp; versions
        </summary>
        <ul className="mt-3 flex flex-col items-center gap-1.5">
          {all.map((d) => (
            <li key={d.url}>
              <a
                href={d.url}
                className="text-sm text-stone-300 transition hover:text-emerald-400"
              >
                {d.label}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd site && pnpm test src/components/DownloadButton.test.tsx`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add site/src/components/DownloadButton.tsx site/src/components/DownloadButton.test.tsx
git commit -m "feat(site): add OS-aware DownloadButton"
```

---

## Task 5: `Hero` section

**Files:**
- Create: `site/src/components/Hero.tsx`
- Test: `site/src/components/Hero.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `site/src/components/Hero.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Hero from "./Hero";

describe("Hero", () => {
  it("renders the logo, headline, and a download CTA", () => {
    render(<Hero os="mac" macArch="apple" />);
    expect(screen.getByAltText(/openwispr/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1 }),
    ).toHaveTextContent(/voice/i);
    expect(
      screen.getByRole("link", { name: /download for macOS/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd site && pnpm test src/components/Hero.test.tsx`
Expected: FAIL — "Failed to resolve import './Hero'".

- [ ] **Step 3: Write the implementation**

Create `site/src/components/Hero.tsx`:

```tsx
import type { MacArch, OS } from "../lib/os";
import DownloadButton from "./DownloadButton";

/// Above-the-fold hero: brand, value proposition, and the smart download CTA,
/// over a dark stone gradient with an emerald glow.
export default function Hero({ os, macArch }: { os: OS; macArch: MacArch }) {
  return (
    <header className="relative overflow-hidden bg-stone-950">
      {/* Emerald radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-10rem] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl"
      />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 pb-24 pt-20 text-center">
        <img
          src="/openwispr/logo.png"
          alt="OpenWispr"
          className="mb-8 h-20 w-20 rounded-2xl shadow-xl"
        />
        <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-stone-700 bg-stone-900 px-3 py-1 text-xs font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          100% local · free &amp; open source
        </span>
        <h1 className="text-balance text-5xl font-bold tracking-tight text-stone-50 sm:text-6xl">
          Speak. It just{" "}
          <span className="bg-gradient-to-r from-emerald-400 to-emerald-200 bg-clip-text text-transparent">
            appears.
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-stone-300">
          OpenWispr is a private voice dictation app. Press a hotkey, speak, and
          your words land in any app — transcribed on-device, never in the cloud.
        </p>
        <div className="mt-10">
          <DownloadButton os={os} macArch={macArch} />
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd site && pnpm test src/components/Hero.test.tsx`
Expected: PASS — 1 test green.

- [ ] **Step 5: Commit**

```bash
git add site/src/components/Hero.tsx site/src/components/Hero.test.tsx
git commit -m "feat(site): add Hero section"
```

---

## Task 6: `Features`, `HowItWorks`, and `Footer` sections

**Files:**
- Create: `site/src/components/Features.tsx`
- Create: `site/src/components/HowItWorks.tsx`
- Create: `site/src/components/Footer.tsx`
- Test: `site/src/components/sections.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `site/src/components/sections.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Features from "./Features";
import HowItWorks from "./HowItWorks";
import Footer from "./Footer";

describe("content sections", () => {
  it("Features lists multiple feature cards", () => {
    render(<Features />);
    expect(screen.getByText(/on-device/i)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThanOrEqual(
      4,
    );
  });

  it("HowItWorks shows numbered steps", () => {
    render(<HowItWorks />);
    expect(screen.getByText(/press your hotkey/i)).toBeInTheDocument();
  });

  it("Footer links to the GitHub repo", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: /github/i })).toHaveAttribute(
      "href",
      expect.stringContaining("github.com/hudsonbrendon/openwispr"),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd site && pnpm test src/components/sections.test.tsx`
Expected: FAIL — "Failed to resolve import './Features'".

- [ ] **Step 3: Create `site/src/components/Features.tsx`**

```tsx
const FEATURES = [
  {
    title: "On-device transcription",
    body: "Whisper runs locally. Your audio never leaves your machine — no accounts, no servers, no telemetry.",
  },
  {
    title: "Works in every app",
    body: "Dictated text is typed straight into the focused field — your editor, browser, chat, anywhere.",
  },
  {
    title: "Press-hold or double-tap",
    body: "Hold the hotkey to dictate a burst, or double-tap to toggle hands-free. The floating pill shows your levels.",
  },
  {
    title: "Custom vocabulary & snippets",
    body: "Teach it your names and jargon, and expand spoken triggers into canned text automatically.",
  },
  {
    title: "Your language",
    body: "Transcribe in 15+ languages, switchable on the fly from the pill or the tray.",
  },
  {
    title: "Free & open source",
    body: "MIT-licensed and built on Tauri. Audit it, fork it, ship it. Updates arrive automatically.",
  },
];

/// Feature grid summarizing the product's value points.
export default function Features() {
  return (
    <section className="bg-stone-950 py-24">
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-stone-50">
          Built for fast, private dictation
        </h2>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-stone-800 bg-stone-900 p-6 transition hover:border-emerald-700/60 hover:bg-stone-800/60"
            >
              <h3 className="text-lg font-semibold text-stone-100">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `site/src/components/HowItWorks.tsx`**

```tsx
const STEPS = [
  {
    n: "1",
    title: "Press your hotkey",
    body: "A floating pill appears above your taskbar and starts listening.",
  },
  {
    n: "2",
    title: "Speak naturally",
    body: "Watch the live audio meter. Click to stop, or release the hotkey.",
  },
  {
    n: "3",
    title: "Text appears",
    body: "Your words are transcribed on-device and typed into the active app.",
  },
];

/// Three-step explanation strip.
export default function HowItWorks() {
  return (
    <section className="border-y border-stone-800 bg-stone-900 py-24">
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-stone-50">
          How it works
        </h2>
        <div className="mt-14 grid gap-8 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white">
                {s.n}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-stone-100">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Create `site/src/components/Footer.tsx`**

```tsx
import { REPO } from "../lib/releases";

/// Site footer with project links.
export default function Footer() {
  return (
    <footer className="bg-stone-950 py-12">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 text-center">
        <img
          src="/openwispr/logo.png"
          alt="OpenWispr"
          className="h-10 w-10 rounded-xl"
        />
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-stone-400">
          <a
            href={`https://github.com/${REPO}`}
            className="transition hover:text-emerald-400"
          >
            GitHub
          </a>
          <a
            href={`https://github.com/${REPO}/releases`}
            className="transition hover:text-emerald-400"
          >
            Releases
          </a>
          <a
            href={`https://github.com/${REPO}/blob/main/LICENSE`}
            className="transition hover:text-emerald-400"
          >
            License
          </a>
        </nav>
        <p className="text-xs text-stone-600">
          MIT-licensed · built with Tauri &amp; Whisper
        </p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd site && pnpm test src/components/sections.test.tsx`
Expected: PASS — 3 tests green.

- [ ] **Step 7: Commit**

```bash
git add site/src/components/Features.tsx site/src/components/HowItWorks.tsx site/src/components/Footer.tsx site/src/components/sections.test.tsx
git commit -m "feat(site): add Features, HowItWorks, and Footer sections"
```

---

## Task 7: Compose `App.tsx`, wire detection, copy the logo

**Files:**
- Modify: `site/src/App.tsx`
- Test: `site/src/App.test.tsx`
- Create: `site/public/logo.png` (copied asset)

- [ ] **Step 1: Copy the logo into the site's public dir**

Run: `cp assets/logo.png site/public/logo.png`
Expected: `site/public/logo.png` exists (~824 KB). Verify: `ls -la site/public/logo.png`.

- [ ] **Step 2: Write the failing test**

Create `site/src/App.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
  });

  it("renders the page and a platform-detected CTA", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /download for windows/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd site && pnpm test src/App.test.tsx`
Expected: FAIL — the placeholder `App` renders only "OpenWispr"; no heading/CTA, assertions fail.

- [ ] **Step 4: Replace `site/src/App.tsx`**

```tsx
import { useMemo } from "react";
import { detectMacArch, detectOS } from "./lib/os";
import Hero from "./components/Hero";
import Features from "./components/Features";
import HowItWorks from "./components/HowItWorks";
import Footer from "./components/Footer";

/// Detects the visitor's platform once, then renders the landing page with a
/// download CTA tailored to it.
export default function App() {
  const { os, macArch } = useMemo(() => {
    const os = detectOS();
    return { os, macArch: os === "mac" ? detectMacArch() : ("unknown" as const) };
  }, []);

  return (
    <div className="min-h-screen bg-stone-950 font-sans text-stone-100 antialiased">
      <Hero os={os} macArch={macArch} />
      <Features />
      <HowItWorks />
      <Footer />
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd site && pnpm test src/App.test.tsx`
Expected: PASS — 1 test green.

- [ ] **Step 6: Run the full site test suite + build**

Run: `cd site && pnpm test`
Expected: all tests pass (releases 8 + os 8 + DownloadButton 2 + Hero 1 + sections 3 + App 1 = 24).

Run: `cd site && pnpm build`
Expected: `tsc` + `vite build` succeed; `site/dist/index.html` references `/openwispr/assets/...` and `/openwispr/logo.png`.

- [ ] **Step 7: Lint and format-check the site**

Run: `cd site && pnpm lint`
Expected: "No issues" (exit 0).

Run: `cd site && pnpm format:check`
Expected: all files formatted, exit 0. If it reports issues, run `cd site && pnpm exec prettier --write .` and re-check.

- [ ] **Step 8: Commit**

```bash
git add site/src/App.tsx site/src/App.test.tsx site/public/logo.png
git commit -m "feat(site): compose landing page with platform detection"
```

---

## Task 8: Keep root CI green — ignore `site/` from root tooling

**Files:**
- Modify: `eslint.config.js` (root) — add `site` to `ignores`
- Modify: `vitest.config.ts` (root) — add `**/site/**` to `test.exclude`
- Create: `.prettierignore` (root) — ignore `site` (if the file already exists, append the line)

- [ ] **Step 1: Add `site` to the root eslint ignores**

In `eslint.config.js`, change the ignores block:

```js
  {
    ignores: [
      "dist",
      "coverage",
      "src-tauri/target",
      "src-tauri/gen",
      ".claude",
      "site",
      "**/*.config.js",
    ],
  },
```

- [ ] **Step 2: Add `site` to root vitest exclude**

In `vitest.config.ts`, change the `exclude` line:

```ts
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/site/**"],
```

- [ ] **Step 3: Create/append the root `.prettierignore`**

Check first: `cat .prettierignore 2>/dev/null`. If it does not exist, create `.prettierignore` with:

```
site
dist
coverage
src-tauri/target
src-tauri/gen
pnpm-lock.yaml
```

If it already exists, ensure it contains a line `site` (append if missing).

- [ ] **Step 4: Verify root tooling ignores the site**

Run (from repo root): `pnpm lint`
Expected: "No issues" — and it does NOT report errors from `site/` files.

Run (from repo root): `pnpm test`
Expected: the existing 195 tests pass; Vitest does NOT collect `site/src/**` tests (test count unchanged at 195).

Run (from repo root): `pnpm format:check`
Expected: exit 0; `site/` files are not checked by the root Prettier.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js vitest.config.ts .prettierignore
git commit -m "chore: exclude site/ from root lint, test, and format"
```

---

## Task 9: GitHub Actions workflow to deploy `site/` to Pages

**Files:**
- Create: `.github/workflows/pages.yml`

> **Auth note:** the local `gh`/git token may lack the `workflow` OAuth scope, which blocks pushing new files under `.github/workflows/` via the API. Push over SSH (the repo's `origin` is `git@github.com:...`), which is not subject to that restriction. A normal `git push origin main` from the CLI works.

- [ ] **Step 1: Create `.github/workflows/pages.yml`**

```yaml
name: Deploy site to Pages

# Build the marketing site (site/) and publish it to GitHub Pages on every
# push to main that touches the site or this workflow.
on:
  push:
    branches: [main]
    paths:
      - "site/**"
      - ".github/workflows/pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# Allow one concurrent deployment; cancel in-progress runs on new pushes.
concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v6
        with:
          version: 10

      - uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: site/pnpm-lock.yaml

      - name: Install
        run: pnpm install --frozen-lockfile
        working-directory: site

      - name: Build
        run: pnpm build
        working-directory: site

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: site/dist

  deploy:
    needs: build
    runs-on: ubuntu-22.04
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Enable GitHub Pages with the "GitHub Actions" source**

GitHub Pages must be set to deploy from Actions (one-time). Run:

```bash
gh api -X POST repos/hudsonbrendon/openwispr/pages \
  -f 'build_type=workflow' 2>/dev/null \
  || gh api -X PUT repos/hudsonbrendon/openwispr/pages -f 'build_type=workflow'
```

Expected: returns a JSON object with `"build_type": "workflow"`. If it returns 409/already-exists, that's fine — Pages is already enabled. If both calls fail due to token scope, instruct the user to set **Settings → Pages → Build and deployment → Source: GitHub Actions** manually.

- [ ] **Step 3: Commit and push over SSH**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: deploy marketing site to GitHub Pages"
git push origin main
```

Expected: push succeeds; the "Deploy site to Pages" workflow starts (it matches `site/**` and the workflow path).

- [ ] **Step 4: Watch the deploy run to completion**

Run: `gh run list --workflow=pages.yml --limit 1 --json databaseId --jq '.[0].databaseId'` to get the run id, then `gh run watch <id> --exit-status`.
Expected: both `build` and `deploy` jobs succeed (exit 0).

---

## Task 10: Verify the live site and finalize

**Files:** none (verification only).

- [ ] **Step 1: Confirm the site is live and serves the page**

Run: `curl -sSI https://hudsonbrendon.github.io/openwispr/ | head -1`
Expected: `HTTP/2 200`. (Pages can take 1–2 minutes after the first deploy; retry if 404.)

Run: `curl -sS https://hudsonbrendon.github.io/openwispr/ | grep -o '<title>[^<]*</title>'`
Expected: `<title>OpenWispr — Local-first voice dictation</title>`.

- [ ] **Step 2: Confirm hashed assets resolve under the base path**

Run: `curl -sS https://hudsonbrendon.github.io/openwispr/ | grep -oE '/openwispr/assets/[^"]+\.js'`
Expected: prints at least one `/openwispr/assets/index-*.js` path.

Run: `curl -sSI https://hudsonbrendon.github.io/openwispr/logo.png | head -1`
Expected: `HTTP/2 200` (the logo loads).

- [ ] **Step 3: Spot-check a download link resolves to a real asset**

Run: `curl -sSI -L https://github.com/hudsonbrendon/openwispr/releases/download/v1.0.0/OpenWispr_1.0.0_x64-setup.exe | grep -i '^HTTP'`
Expected: ends with a `200` (the asset exists and downloads).

- [ ] **Step 4: Add the live site link to the README**

In `README.md`, add a "Website" link near the top (under the badges/title). Find the first heading or badge block and insert:

```markdown
**[🌐 openwispr website & downloads](https://hudsonbrendon.github.io/openwispr/)**
```

Run: `grep -n "hudsonbrendon.github.io/openwispr" README.md`
Expected: prints the inserted line.

- [ ] **Step 5: Commit the README link (final commit)**

```bash
git add README.md
git commit -m "docs: link the OpenWispr website in the README"
git push origin main
```

- [ ] **Step 6: Final review**

Dispatch the final code reviewer over the whole `site/` addition + workflow (per subagent-driven-development's end-of-plan step). Confirm: detection logic is correct, base path is consistent everywhere, no hardcoded version drift between `releases.ts` and asset names, root CI untouched.

---

## Self-Review

**1. Spec coverage:**
- "create a site for the project" → Tasks 1–7 (full landing page). ✓
- "host it on GitHub Pages" → Tasks 9–10 (Actions deploy + verify). ✓
- "identify the user's OS and enable the download button automatically based on the user's system" → Task 3 (`detectOS`), Task 2 (`pickPrimary`), Task 4 (`DownloadButton`), Task 7 (wired in `App`). ✓
- macOS arch via WebGL (chosen approach) → Task 3 (`detectMacArch`/`macArchFromRenderer`). ✓
- "interactive and visually beautiful and modern" → hover/lift transitions, gradient hero with emerald glow, `<details>` disclosure for all platforms (Tasks 4–6). ✓
- "follow the project's standard colors" → stone + emerald + zinc throughout. ✓
- "have the logo and everything" → logo copied (Task 7), used in Hero/Footer/favicon/OG. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every command lists expected output. ✓

**3. Type consistency:** `OS = "mac" | "windows" | "linux" | "unknown"` and `MacArch = "apple" | "intel" | "unknown"` are defined in `os.ts` (Task 3) and imported by `releases.ts` (Task 2), `DownloadButton.tsx` (Task 4), `Hero.tsx` (Task 5), and `App.tsx` (Task 7) with matching names. `pickPrimary(os, macArch)`, `allDownloads()`, `downloadUrl(asset)`, `detectOS()`, `detectMacArch()` signatures are identical at definition and every call site. `REPO`/`VERSION`/`ASSETS` are defined once in `releases.ts` and reused. The Vite `base` (`/openwispr/`) matches the favicon/logo/OG absolute paths in `index.html`, the `src` attributes in `Hero`/`Footer`, and the verification greps in Task 10. ✓

> **Ordering note:** Task 2's `releases.ts` imports a type from Task 3's `os.ts`. Vitest erases types so `releases.test.ts` passes standalone, but the first `pnpm build` requires `os.ts` to exist — Task 3 Step 5 is the first build and runs after `os.ts` is created. Execute tasks in order.
