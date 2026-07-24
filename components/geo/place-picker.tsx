"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CloseIcon, GlobeIcon, SpinnerIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reversePlace, suggestPlaces } from "@/lib/geo/client";
import { GeoError, type Place } from "@/lib/geo/types";
import type { PassportLocationSelection } from "@/lib/passport/metadata-form";
import { cn } from "@/lib/utils";

const SUGGEST_DEBOUNCE_MS = 300;
const GEOLOCATION_TIMEOUT_MS = 10_000;

export type PlacePickerValue = PassportLocationSelection;

export type PlacePickerProps = {
  value: PlacePickerValue | null;
  onChange: (value: PlacePickerValue | null) => void;
  disabled?: boolean;
  id?: string;
  error?: string;
  label?: string;
};

function selectionFromPlace(place: Place): PlacePickerValue {
  return {
    label: place.label,
    placeId: place.placeId,
    countryCode: place.countryCode,
    city: place.city,
    region: place.region ?? "",
  };
}

function browserLang(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const lang = navigator.language?.slice(0, 2)?.toLowerCase();
  return lang && /^[a-z]{2}$/.test(lang) ? lang : undefined;
}

function geoErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof GeoError) {
    if (err.code === "invalid_query") return "Enter a city name to search.";
    return "Location lookup failed. Try again.";
  }
  return fallback;
}

export function PlacePicker({
  value,
  onChange,
  disabled = false,
  id: idProp,
  error,
  label = "Location",
}: PlacePickerProps) {
  const autoId = useId();
  const inputId = idProp ?? autoId;
  const listId = `${inputId}-list`;

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [locateBusy, setLocateBusy] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const requestGen = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value != null) {
      setQuery("");
      setSuggestions([]);
      setSuggestOpen(false);
      setSuggestError(null);
    }
  }, [value?.placeId]);

  useEffect(() => {
    if (value != null || disabled) return;
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestOpen(false);
      setSuggestLoading(false);
      setSuggestError(null);
      return;
    }

    const gen = ++requestGen.current;
    setSuggestLoading(true);
    setSuggestError(null);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const places = await suggestPlaces({ q, lang: browserLang() });
          if (gen !== requestGen.current) return;
          setSuggestions(places);
          setSuggestOpen(true);
          setSuggestLoading(false);
        } catch (err) {
          if (gen !== requestGen.current) return;
          setSuggestions([]);
          setSuggestOpen(false);
          setSuggestLoading(false);
          setSuggestError(geoErrorMessage(err, "City search failed. Try again."));
        }
      })();
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [query, value, disabled]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function selectPlace(place: Place) {
    onChange(selectionFromPlace(place));
    setQuery("");
    setSuggestions([]);
    setSuggestOpen(false);
    setSuggestError(null);
    setLocateError(null);
  }

  function clearSelection() {
    onChange(null);
    setQuery("");
    setSuggestions([]);
    setSuggestOpen(false);
    setSuggestError(null);
    setLocateError(null);
  }

  function useMyLocation() {
    if (disabled || locateBusy) return;
    setLocateError(null);
    setSuggestError(null);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateError("Location is not available in this browser.");
      return;
    }

    setLocateBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          try {
            const place = await reversePlace({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              lang: browserLang(),
            });
            if (place == null) {
              setLocateError("No city found for your location.");
              return;
            }
            selectPlace(place);
          } catch (err) {
            setLocateError(
              geoErrorMessage(err, "Could not resolve your location. Try searching."),
            );
          } finally {
            setLocateBusy(false);
          }
        })();
      },
      (geoErr) => {
        setLocateBusy(false);
        if (geoErr.code === geoErr.PERMISSION_DENIED) {
          setLocateError("Location permission denied. Search for a city instead.");
          return;
        }
        if (geoErr.code === geoErr.TIMEOUT) {
          setLocateError("Location timed out. Search for a city instead.");
          return;
        }
        setLocateError("Could not read your location. Search for a city instead.");
      },
      { enableHighAccuracy: false, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 60_000 },
    );
  }

  const fieldError = error ?? suggestError ?? locateError;
  const selected = value != null;

  return (
    <div ref={rootRef} className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        {label ? <Label htmlFor={inputId}>{label}</Label> : <span />}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || locateBusy}
          onClick={useMyLocation}
          className="h-auto shrink-0 px-0 text-xs font-normal text-text-secondary hover:text-text-primary"
        >
          {locateBusy ? (
            <span className="inline-flex items-center gap-1.5">
              <SpinnerIcon size={14} className="animate-spin" />
              Locating…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <GlobeIcon size={14} />
              Use my location
            </span>
          )}
        </Button>
      </div>

      {selected ? (
        <div
          className={cn(
            "flex min-h-11 items-center justify-between gap-2 rounded-md border border-border-default bg-bg-surface px-3",
            disabled && "opacity-60",
          )}
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-text-primary">{value.label}</p>
            <p className="font-mono text-xs tabular-nums text-text-tertiary">
              {value.countryCode}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            aria-label="Clear location"
            onClick={clearSelection}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-bg-primary hover:text-text-primary disabled:opacity-50"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Input
            id={inputId}
            value={query}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-expanded={suggestOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder="Search for a city"
            onChange={(e) => {
              setQuery(e.target.value);
              setLocateError(null);
            }}
            onFocus={() => {
              if (suggestions.length > 0) setSuggestOpen(true);
            }}
            className={cn(fieldError && "border-status-error")}
          />
          {suggestLoading ? (
            <SpinnerIcon
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-text-tertiary"
            />
          ) : null}
          {suggestOpen && suggestions.length > 0 ? (
            <ul
              id={listId}
              role="listbox"
              className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border-default bg-bg-primary py-1"
            >
              {suggestions.map((place) => (
                <li key={place.placeId} role="option">
                  <button
                    type="button"
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-bg-surface"
                    onClick={() => selectPlace(place)}
                  >
                    <span className="min-w-0 truncate text-text-primary">
                      {place.label}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-text-tertiary">
                      {place.countryCode}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {suggestOpen &&
          !suggestLoading &&
          query.trim().length >= 2 &&
          suggestions.length === 0 &&
          !suggestError ? (
            <p className="mt-1.5 text-xs text-text-tertiary">No cities found.</p>
          ) : null}
        </div>
      )}

      {fieldError ? (
        <p className="text-xs text-status-error" role="alert">
          {fieldError}
        </p>
      ) : (
        <p className="text-xs text-text-tertiary">
          City and country only. Select from the list.
        </p>
      )}
    </div>
  );
}
