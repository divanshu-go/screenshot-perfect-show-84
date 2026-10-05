import { lazy, Suspense, useEffect, useState } from "react";

const Agentation = import.meta.env.DEV
  ? lazy(() => import("agentation").then((module) => ({ default: module.Agentation })))
  : null;

export function DevelopmentTools() {
  const [hasDesktopViewport, setHasDesktopViewport] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setHasDesktopViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  if (!Agentation || !hasDesktopViewport) return null;

  return (
    <Suspense fallback={null}>
      <Agentation />
    </Suspense>
  );
}
