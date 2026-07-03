"use client";

import { useEffect, useState } from "react";

const MD_MEDIA_QUERY = "(min-width: 768px)";

export function useMediaMd(): { isMd: boolean } {
  const [isMd, setIsMd] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(MD_MEDIA_QUERY);
    const sync = () => setIsMd(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return { isMd };
}
