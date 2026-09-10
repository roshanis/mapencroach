"use client";

import { useEffect, useRef, useState } from "react";
import { loadGooglePlacesLibrary } from "./googleMapsLoader";

export interface GoogleLocationSearchProps {
  apiKey: string;
  onLocationSelect: (location: { lat: number; lng: number }) => void;
}

const FAILURE_MESSAGE = "Location search unavailable. Try again.";

type PlacePrediction = {
  toPlace: () => {
    fetchFields: (options: { fields: string[] }) => Promise<void>;
    location?: { lat?: () => number; lng?: () => number };
  };
};

export default function GoogleLocationSearch({
  apiKey,
  onLocationSelect,
}: GoogleLocationSearchProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef(false);
  const callbackRef = useRef(onLocationSelect);
  const selectionGenerationRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectionLoading, setSelectionLoading] = useState(false);

  useEffect(() => {
    callbackRef.current = onLocationSelect;
  }, [onLocationSelect]);

  useEffect(() => {
    if (!open && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      toggleRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const container = containerRef.current;
    let mountedElement: HTMLElement | null = null;
    let selectListener: ((event: Event) => void) | null = null;
    let errorListener: (() => void) | null = null;
    if (!container) return;
    const mountContainer = container;
    setLoading(true);
    setSelectionLoading(false);

    const clear = () => {
      mountContainer.replaceChildren();
    };

    async function mountAutocomplete() {
      try {
        const { PlaceAutocompleteElement } = await loadGooglePlacesLibrary(apiKey);
        if (cancelled || !containerRef.current) return;

        const autocomplete = new PlaceAutocompleteElement();
        mountedElement = autocomplete;
        autocomplete.setAttribute("placeholder", "Search for an address or place");
        autocomplete.style.display = "block";
        autocomplete.style.width = "100%";
        autocomplete.style.minWidth = "0";
        const onSelect = async (event: Event) => {
          const candidate = event as Event & {
            placePrediction?: PlacePrediction;
            detail?: { placePrediction?: PlacePrediction };
          };
          const prediction = candidate.placePrediction ?? candidate.detail?.placePrediction;
          if (!prediction || cancelled) return;
          const selectionGeneration = ++selectionGenerationRef.current;
          setSelectionLoading(true);
          setError(false);

          try {
            const place = prediction.toPlace();
            await place.fetchFields({ fields: ["location"] });
            if (cancelled || !open || selectionGeneration !== selectionGenerationRef.current) return;
            const lat = place.location?.lat?.();
            const lng = place.location?.lng?.();
            if (
              typeof lat !== "number" ||
              typeof lng !== "number" ||
              !Number.isFinite(lat) ||
              !Number.isFinite(lng) ||
              lat < -90 ||
              lat > 90 ||
              lng < -180 ||
              lng > 180
            ) {
              setError(true);
              setSelectionLoading(false);
              return;
            }
            setSelectionLoading(false);
            callbackRef.current({ lat, lng });
          } catch {
            if (!cancelled && selectionGeneration === selectionGenerationRef.current) {
              setSelectionLoading(false);
              setError(true);
            }
          }
        };
        const onError = () => {
          selectionGenerationRef.current += 1;
          if (!cancelled) {
            setSelectionLoading(false);
            setError(true);
          }
        };
        selectListener = onSelect;
        errorListener = onError;
        autocomplete.addEventListener("gmp-select", selectListener);
        autocomplete.addEventListener("gmp-error", errorListener);
        mountContainer.appendChild(autocomplete);
        setLoading(false);
        autocomplete.focus?.();
      } catch {
        if (!cancelled) {
          setLoading(false);
          setError(true);
        }
      }
    }

    setError(false);
    void mountAutocomplete();
    return () => {
      cancelled = true;
      selectionGenerationRef.current += 1;
      if (mountedElement && selectListener && errorListener) {
        mountedElement.removeEventListener("gmp-select", selectListener);
        mountedElement.removeEventListener("gmp-error", errorListener);
      }
      clear();
    };
  }, [apiKey, open, retry]);

  function close() {
    restoreFocusRef.current = true;
    selectionGenerationRef.current += 1;
    setOpen(false);
    setError(false);
    setRetry((value) => value + 1);
  }

  if (!open) {
    return (
      <button ref={toggleRef} type="button" aria-expanded={false} className="min-h-11 rounded border border-gray-300 bg-white px-3 text-sm shadow-sm" onClick={() => setOpen(true)}>
        Search location
      </button>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2" data-testid="google-location-search">
      <p className="basis-full text-xs text-gray-600">Find a location on the map; select parcels from the work queue.</p>
      <div ref={containerRef} role="group" aria-label="Search location" className="min-h-11 min-w-0 flex-1" />
      <button type="button" aria-label="Close location search" className="min-h-11 rounded border border-gray-300 bg-white px-3 text-sm shadow-sm" onClick={close}>
        Close
      </button>
      {loading || selectionLoading ? <p role="status" className="basis-full text-sm text-gray-600">{selectionLoading ? "Loading location…" : "Loading location search…"}</p> : null}
      {error ? (
        <div role="alert" className="basis-full">
          <span>{FAILURE_MESSAGE}</span>{" "}
          <button type="button" className="min-h-11 rounded border border-gray-300 bg-white px-3 text-sm shadow-sm" onClick={() => { selectionGenerationRef.current += 1; setError(false); setRetry((value) => value + 1); }}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
