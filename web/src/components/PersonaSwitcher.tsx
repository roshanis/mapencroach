"use client";

import { useEffect, useState } from "react";
import { getPersonas, loginPersona, PERSONA_COOKIE, TOKEN_COOKIE, type Persona } from "@/lib/api";
import {
  PERSONA_META_COOKIE,
  clearCookie,
  readCookie,
  setCookie,
} from "@/lib/cookies";

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
    setCookie(
      PERSONA_META_COOKIE,
      JSON.stringify({
        name: result.persona.name,
        role: result.persona.role,
        jurisdiction_id: result.persona.jurisdiction_id,
        jurisdiction_name: result.persona.jurisdiction_name,
      })
    );
    window.location.reload();
  }

  function handleReset() {
    clearCookie(TOKEN_COOKIE);
    clearCookie(PERSONA_COOKIE);
    clearCookie(PERSONA_META_COOKIE);
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
