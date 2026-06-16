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
