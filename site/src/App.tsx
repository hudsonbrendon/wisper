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
    return {
      os,
      macArch: os === "mac" ? detectMacArch() : ("unknown" as const),
    };
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
