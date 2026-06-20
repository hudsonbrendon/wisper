// OpenWispr site interactions: refresh flash, theme, i18n, reveals,
// OS-aware download wiring, and a live version pulled from GitHub Releases.
(function () {
  "use strict";

  var REPO = "99labdev/wisper.chat";
  var FALLBACK_VERSION = "1.0.0";

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var I18N = window.OPENWISPR_I18N || { en: {} };
  var LANGS = window.OPENWISPR_LANGS || [
    { code: "en", native: "English", lang: "en" },
  ];
  var BASE = I18N.en || {};

  /* ---------- refresh flash ---------- */
  function flash() {
    if (reduceMotion) return;
    var el = document.getElementById("flash");
    if (!el) return;
    document.body.classList.remove("flashing");
    void el.offsetWidth; // restart animation
    document.body.classList.add("flashing");
    window.setTimeout(function () {
      document.body.classList.remove("flashing");
    }, 700);
  }
  window.requestAnimationFrame(flash);

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("ow-theme", theme);
    } catch (e) {}
    var t = document.querySelector(".theme-toggle");
    if (t)
      t.setAttribute(
        "aria-label",
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      );
  }
  document.querySelectorAll(".theme-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var next =
        document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      flash();
    });
  });

  /* ---------- i18n ---------- */
  function langMeta(code) {
    return (
      LANGS.find(function (l) {
        return l.code === code;
      }) || LANGS[0]
    );
  }
  function hasLang(code) {
    return LANGS.some(function (l) {
      return l.code === code;
    });
  }
  function detectLang() {
    try {
      var saved = localStorage.getItem("ow-lang");
      if (saved && hasLang(saved)) return saved;
    } catch (e) {}
    var nav = (navigator.language || "en").toLowerCase();
    var prefix = nav.split("-")[0];
    var hit = LANGS.find(function (l) {
      var lang = l.lang.toLowerCase();
      return lang === nav || lang.split("-")[0] === prefix || l.code === prefix;
    });
    return hit ? hit.code : "en";
  }
  function t(dict, key) {
    return dict[key] != null ? dict[key] : BASE[key];
  }
  function applyLang(code) {
    var dict = I18N[code] || BASE;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var v = t(dict, el.getAttribute("data-i18n"));
      if (v != null) el.textContent = v;
    });
    var meta = langMeta(code);
    document.documentElement.lang = meta.lang;
    document.documentElement.dir = meta.rtl ? "rtl" : "ltr";
    return dict;
  }

  var currentLang = detectLang();
  document.querySelectorAll(".lang-select").forEach(function (sel) {
    LANGS.forEach(function (l) {
      var opt = document.createElement("option");
      opt.value = l.code;
      opt.textContent = l.native;
      sel.appendChild(opt);
    });
    sel.value = currentLang;
    sel.addEventListener("change", function () {
      var code = sel.value;
      try {
        localStorage.setItem("ow-lang", code);
      } catch (e) {}
      document.querySelectorAll(".lang-select").forEach(function (s) {
        s.value = code;
      });
      activeDict = applyLang(code);
      refreshDownloadLabels();
      if (window.__restartDemo) window.__restartDemo();
      flash();
    });
  });
  var activeDict = applyLang(currentLang);

  /* ---------- OS + arch detection ---------- */
  function detectOS() {
    var uaData = navigator.userAgentData;
    var platform = (uaData && uaData.platform) || navigator.platform || "";
    var s = (platform + " " + navigator.userAgent).toLowerCase();
    if (/mac|iphone|ipad|ipod/.test(s)) return "mac";
    if (/win/.test(s)) return "windows";
    if (/linux|x11|ubuntu|fedora|debian/.test(s)) return "linux";
    return "unknown";
  }
  // Best-effort Apple Silicon vs Intel via the WebGL GPU string.
  function detectMacArch() {
    try {
      var canvas = document.createElement("canvas");
      var gl =
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return "unknown";
      var ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (!ext) return "unknown";
      var r = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || "").toLowerCase();
      if (r.indexOf("apple") !== -1) return "apple";
      if (r.indexOf("intel") !== -1 || r.indexOf("amd") !== -1 || r.indexOf("radeon") !== -1)
        return "intel";
      return "unknown";
    } catch (e) {
      return "unknown";
    }
  }

  var OS = detectOS();
  var MAC_ARCH = OS === "mac" ? detectMacArch() : "unknown";

  /* ---------- download model ----------
     Starts from a hardcoded fallback (the known v1.0.0 assets) and is
     upgraded in place once the live GitHub release responds, so links keep
     working offline / rate-limited and self-heal on every new release. */
  function assetSet(version) {
    var base =
      "https://github.com/" + REPO + "/releases/download/v" + version + "/";
    return {
      version: version,
      macApple: base + "OpenWispr_" + version + "_aarch64.dmg",
      macIntel: base + "OpenWispr_" + version + "_x64.dmg",
      windows: base + "OpenWispr_" + version + "_x64-setup.exe",
      linuxAppImage: base + "OpenWispr_" + version + "_amd64.AppImage",
      linuxDeb: base + "OpenWispr_" + version + "_amd64.deb",
      linuxRpm: base + "OpenWispr-" + version + "-1.x86_64.rpm",
    };
  }
  var assets = assetSet(FALLBACK_VERSION);

  function primary() {
    if (OS === "mac")
      return MAC_ARCH === "intel"
        ? { key: "dl_mac_intel", fallback: "Download for macOS (Intel)", url: assets.macIntel }
        : { key: "dl_mac_apple", fallback: "Download for macOS (Apple Silicon)", url: assets.macApple };
    if (OS === "windows")
      return { key: "dl_win", fallback: "Download for Windows", url: assets.windows };
    if (OS === "linux")
      return { key: "dl_linux", fallback: "Download for Linux", url: assets.linuxAppImage };
    return {
      key: "dl_generic",
      fallback: "Download OpenWispr",
      url: "https://github.com/" + REPO + "/releases/latest",
    };
  }
  function allList() {
    return [
      { label: "macOS · Apple Silicon (.dmg)", url: assets.macApple },
      { label: "macOS · Intel (.dmg)", url: assets.macIntel },
      { label: "Windows (.exe)", url: assets.windows },
      { label: "Linux (.AppImage)", url: assets.linuxAppImage },
      { label: "Linux (.deb)", url: assets.linuxDeb },
      { label: "Linux (.rpm)", url: assets.linuxRpm },
    ];
  }

  function refreshDownloadLabels() {
    var p = primary();
    var label = t(activeDict, p.key) || p.fallback;
    ["hero-dl", "cta-dl"].forEach(function (id) {
      var a = document.getElementById(id);
      if (!a) return;
      a.href = p.url;
      var span = a.querySelector("span");
      if (span) span.textContent = label;
    });
    var ul = document.getElementById("all-dl-list");
    if (ul) {
      ul.textContent = "";
      allList().forEach(function (d) {
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.href = d.url;
        a.textContent = d.label;
        a.rel = "noopener";
        li.appendChild(a);
        ul.appendChild(li);
      });
    }
  }
  refreshDownloadLabels();

  /* ---------- live version + assets from GitHub Releases ---------- */
  fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (rel) {
      if (!rel || !rel.tag_name) return;
      var version = rel.tag_name.replace(/^v/, "");
      assets = assetSet(version);
      // Prefer the real asset URLs when present (covers naming changes).
      if (Array.isArray(rel.assets)) {
        var byName = {};
        rel.assets.forEach(function (a) {
          byName[a.name] = a.browser_download_url;
        });
        Object.keys(assets).forEach(function (k) {
          if (k === "version") return;
          var name = assets[k].split("/").pop();
          if (byName[name]) assets[k] = byName[name];
        });
      }
      refreshDownloadLabels();
      var tag = "v" + version;
      document.querySelectorAll(".ver-chip").forEach(function (c) {
        c.textContent = tag;
      });
      var meta = document.getElementById("ver-meta");
      if (meta)
        meta.textContent =
          (t(activeDict, "hero_meta3") || "Latest release") + ": " + tag;
    })
    .catch(function () {});

  /* ---------- hero demo: cycle apps + type the dictated text ---------- */
  (function demo() {
    var input = document.getElementById("demo-input");
    var tabs = Array.prototype.slice.call(
      document.querySelectorAll(".tabs .tab"),
    );
    if (!input || !tabs.length) return;
    var timer = null;
    var ai = 1; // first pass lands on ChatGPT (the tab marked active in markup)
    function setActive(i) {
      tabs.forEach(function (tab, k) {
        tab.classList.toggle("active", k === i);
      });
    }
    function loop() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      var text = t(activeDict, "demo_text") || "";
      if (reduceMotion) {
        input.textContent = text;
        return;
      }
      setActive(ai % tabs.length);
      input.textContent = "";
      var n = 0;
      (function type() {
        if (n <= text.length) {
          input.textContent = text.slice(0, n);
          n++;
          timer = setTimeout(type, 45);
        } else {
          timer = setTimeout(function () {
            ai = (ai + 1) % tabs.length;
            loop();
          }, 2000);
        }
      })();
    }
    window.__restartDemo = loop;
    loop();
  })();

  /* ---------- scroll reveals (progressive enhancement) ---------- */
  var ioTargets = document.querySelectorAll("[data-io]");
  if (ioTargets.length && "IntersectionObserver" in window && !reduceMotion) {
    document.documentElement.classList.add("has-io");
    var io = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("seen");
            obs.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    ioTargets.forEach(function (el) {
      io.observe(el);
    });
    window.setTimeout(function () {
      ioTargets.forEach(function (el) {
        el.classList.add("seen");
      });
    }, 2500);
  }
})();
