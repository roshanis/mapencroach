"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PERSONA_COOKIE } from "@/lib/api";
import { PERSONA_META_COOKIE, readCookie } from "@/lib/cookies";
import { jurisdictionLabel, roleLabel } from "@/lib/format";
import {
  exitPersona,
  getPersonas,
  switchPersona,
  type Persona,
} from "./PersonaSwitcher";

interface PersonaMeta {
  name: string;
  role?: string;
  jurisdiction_id?: string;
  jurisdiction_name?: string;
}

function readPersonaMeta(): PersonaMeta | undefined {
  const raw = readCookie(PERSONA_META_COOKIE);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as PersonaMeta;
      if (parsed && typeof parsed.name === "string") return parsed;
    } catch {
      // malformed cookie — fall through to the plain-name fallback below
    }
  }
  const name = readCookie(PERSONA_COOKIE);
  return name ? { name } : undefined;
}

/**
 * Shortens a persona display name for the compact trigger pill, e.g.
 * "Enforcement Officer, Haridwar" -> "Enforcement Officer". Names without a
 * comma are returned unchanged.
 */
function shortPersonaName(name: string): string {
  return name.split(",")[0].trim();
}

/**
 * Consolidated demo-control header menu: replaces the old persona label +
 * <select> + standalone "Demo roles" link with a single trigger button and
 * dropdown. Collapses to an icon-only button below the sm breakpoint so it
 * never contributes to mobile header overflow.
 */
export function DemoMenu() {
  const [open, setOpen] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [meta, setMeta] = useState<PersonaMeta | undefined>(undefined);
  const [switchError, setSwitchError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    getPersonas().then((list) => {
      if (!cancelled) setPersonas(list);
    });
    setMeta(readPersonaMeta());
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  function closeAndRefocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function handleSelect(personaId: string) {
    setSwitchError(false);
    const ok = await switchPersona(personaId);
    if (!ok) setSwitchError(true);
  }

  const triggerLabel = `Demo · ${meta ? shortPersonaName(meta.name) : "Default officer"}`;
  const details = meta
    ? [
        meta.role ? roleLabel(meta.role) : undefined,
        meta.jurisdiction_id
          ? jurisdictionLabel(meta.jurisdiction_id, meta.jurisdiction_name)
          : undefined,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="demo-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-full border border-white/30 px-2 py-1 text-xs text-white/90 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/70 sm:px-3"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 fill-current">
          <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm0 2c-3.31 0-8 1.66-8 4.5V18h16v-1.5c0-2.84-4.69-4.5-8-4.5z" />
        </svg>
        <span className="hidden sm:inline">{triggerLabel}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Demo controls"
          data-testid="demo-menu"
          className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-gray-200 bg-white p-2 text-sm text-gray-900 shadow-xl"
        >
          <div className="border-b border-gray-100 px-2 pb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Viewing as
            </p>
            <p className="mt-0.5 truncate font-medium text-gray-900">
              {meta?.name ?? "Default officer"}
            </p>
            {details && (
              <p className="truncate text-xs text-gray-500">{details}</p>
            )}
          </div>

          {personas.length > 0 ? (
            <ul className="max-h-64 overflow-y-auto py-1">
              {personas.map((persona) => (
                <li key={persona.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelect(persona.id)}
                    className="block w-full rounded px-2 py-1.5 text-left hover:bg-gray-100"
                  >
                    {persona.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-2 text-xs text-gray-500">
              Persona switching needs the demo backend
            </p>
          )}

          {switchError && (
            <p className="px-2 pb-1 text-xs text-red-600">
              Persona switch failed
            </p>
          )}

          <div className="border-t border-gray-100 pt-1">
            <Link
              href="/personas"
              role="menuitem"
              onClick={closeAndRefocus}
              className="block rounded px-2 py-1.5 text-gov hover:bg-gray-100"
            >
              Who sees what →
            </Link>
            {meta && (
              <button
                type="button"
                role="menuitem"
                data-testid="demo-menu-exit"
                onClick={() => exitPersona()}
                className="block w-full rounded px-2 py-1.5 text-left text-red-600 hover:bg-gray-100"
              >
                Exit persona
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
