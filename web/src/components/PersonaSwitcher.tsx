"use client";

import { useEffect, useState } from "react";
import { getPersonas, loginPersona, PERSONA_COOKIE, TOKEN_COOKIE, type Persona } from "@/lib/api";

const COOKIE_MAX_AGE = 28800; // 8 hours, matches demo persona token lifetime.

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!match) return undefined;
  return decodeURIComponent(match.slice(prefix.length));
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

export function PersonaSwitcher() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [currentPersonaName, setCurrentPersonaName] = useState<string>(
    "Default officer"
  );
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPersonas().then((list) => {
      if (!cancelled) setPersonas(list);
    });
    const cookiePersona = readCookie(PERSONA_COOKIE);
    if (cookiePersona) setCurrentPersonaName(cookiePersona);
    return () => {
      cancelled = true;
    };
  }, []);

  if (personas.length === 0) {
    return null;
  }

  async function handleSelect(personaId: string) {
    setError(false);
    const result = await loginPersona(personaId);
    if (!result) {
      setError(true);
      return;
    }
    setCookie(TOKEN_COOKIE, result.token);
    setCookie(PERSONA_COOKIE, result.persona.name);
    window.location.reload();
  }

  function handleReset() {
    clearCookie(TOKEN_COOKIE);
    clearCookie(PERSONA_COOKIE);
    window.location.reload();
  }

  const hasPersonaCookie = Boolean(readCookie(PERSONA_COOKIE));

  return (
    <div
      data-testid="persona-switcher"
      className="flex items-center gap-2 text-xs text-white/90"
    >
      <span data-testid="persona-current">{currentPersonaName}</span>
      <select
        data-testid="persona-select"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) handleSelect(e.target.value);
        }}
        className="rounded border border-white/30 bg-gov px-2 py-1 text-xs text-white"
      >
        <option value="" disabled>
          Switch persona…
        </option>
        {personas.map((persona) => (
          <option key={persona.id} value={persona.id}>
            {persona.name}
          </option>
        ))}
      </select>
      {hasPersonaCookie && (
        <button
          type="button"
          data-testid="persona-reset"
          title="Reset to default officer"
          onClick={handleReset}
          className="rounded px-1 text-white/70 hover:text-white"
        >
          ×
        </button>
      )}
      {error && <span className="text-red-300">Persona switch failed</span>}
    </div>
  );
}
