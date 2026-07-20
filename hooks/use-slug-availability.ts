"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { checkSlugAvailability } from "@/app/actions/kar-pro-slug";
import {
  deriveSlugAvailabilityStatus,
  mapSlugAvailabilityResult,
  type SlugAvailabilityStatus,
} from "@/lib/kar-pro/slug-availability";
import { slugFormatStatus } from "@/lib/kar-pro/kar-pro-slug-rules";

export type { SlugAvailabilityStatus };

const SLUG_AVAILABILITY_DEBOUNCE_MS = 500;
const SLUG_AVAILABILITY_STALE_MS = 30_000;

type UseSlugAvailabilityOptions = {
  slug: string;
  ownerAddress?: string;
  enabled?: boolean;
};

export function useSlugAvailability({
  slug,
  ownerAddress,
  enabled = true,
}: UseSlugAvailabilityOptions): SlugAvailabilityStatus {
  const trimmed = slug.trim();
  const [debouncedSlug, setDebouncedSlug] = useState(trimmed);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSlug(trimmed);
    }, SLUG_AVAILABILITY_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed]);

  const formatReady =
    enabled && slugFormatStatus(debouncedSlug) === "ready";

  const query = useQuery({
    queryKey: ["kar-pro-slug-availability", debouncedSlug, ownerAddress ?? ""],
    queryFn: async () => {
      const result = await checkSlugAvailability(debouncedSlug, ownerAddress);
      return {
        slug: debouncedSlug,
        status: mapSlugAvailabilityResult(result),
      };
    },
    enabled: formatReady,
    staleTime: SLUG_AVAILABILITY_STALE_MS,
    retry: false,
  });

  return deriveSlugAvailabilityStatus({
    slug: trimmed,
    debouncedSlug,
    querySlug: query.data?.slug,
    queryStatus: query.data?.status,
    isFetching: query.isFetching,
    isError: query.isError,
  });
}
