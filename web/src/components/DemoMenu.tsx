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

interface PersonaGroup {
  key: string;
  /** Heading text, or null for the single-authority case (no heading). */
  name: string | null;
  personas: Persona[];
}

/**
 * Groups personas under their authority so a deployment holding more than
 * one government reads as such, instead of as one long undifferentiated
 * list where the second authority happens to be at the bottom.
 *
 * Returns a single unlabelled group when every persona shares an authority
 * (or none report one, as with fixture data), so a single-authority console
 * is visually unchanged rather than growing a redundant header. Original
 * order is preserved within and across groups — the backend's persona order
 * is deliberate, and re-sorting would shuffle the demo script's first pick.
 */
export function groupPersonasByAuthority(personas: Persona[]): PersonaGroup[] {
  const groups: PersonaGroup[] = [];
  const byKey = new Map<string, PersonaGroup>();

  for (const persona of personas) {
    const key = persona.authority_id ?? "";
    let group = byKey.get(key);
    if (!group) {
      group = { key: key || "all", name: persona.authority_name ?? null, personas: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.personas.push(persona);
  }

  // One group means one authority (or an older backend that reports none):
  // a lone heading over the whole list adds nothing, so drop it.
  if (groups.length <= 1) {
    return groups.map((group) => ({ ...group, name: null }));
  }
  return groups;
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
            // `max-h-80` rather than the previous `max-h-64`: with two
            // authorities the list is long enough that the second one sat
            // entirely below the fold, which reads as "Kerala is missing"
            // rather than "scroll down". Still capped and scrollable so a
            // short viewport can never push the footer links off-screen.
            <ul className="max-h-80 overflow-y-auto py-1">
              {groupPersonasByAuthority(personas).map((group) => (
                <li key={group.key}>
                  {group.name && (
                    // Sticky so the authority a row belongs to stays visible
                    // while scrolling -- an unlabelled row in a scrolled list
                    // gives no clue which government it answers to.
                    <p
                      data-testid="persona-authority-heading"
                      className="sticky top-0 bg-white px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                    >
                      {group.name}
                    </p>
                  )}
                  <ul>
                    {group.personas.map((persona) => (
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
