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
    {
      label: "macOS · Apple Silicon (.dmg)",
      url: downloadUrl(ASSETS.macApple),
    },
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
      ? {
          label: "Download for macOS (Intel)",
          url: downloadUrl(ASSETS.macIntel),
        }
      : {
          label: "Download for macOS (Apple Silicon)",
          url: downloadUrl(ASSETS.macApple),
        };
  }
  if (os === "windows") {
    return { label: "Download for Windows", url: downloadUrl(ASSETS.windows) };
  }
  if (os === "linux") {
    return {
      label: "Download for Linux",
      url: downloadUrl(ASSETS.linuxAppImage),
    };
  }
  return {
    label: "Download OpenWispr",
    url: `https://github.com/${REPO}/releases/latest`,
  };
}
