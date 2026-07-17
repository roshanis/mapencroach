"use client";

import { useEffect, useState } from "react";
import {
  getPersonas,
  loginPersona,
  PERSONA_COOKIE,
  TOKEN_COOKIE,
  type Persona,
} from "@/lib/api";
import { PERSONA_META_COOKIE, readCookie, setCookie } from "@/lib/cookies";
import { FIXTURE_PERSONAS } from "@/lib/fixtures";
import { PersonaCard } from "@/components/PersonaCard";
import { TopBar } from "@/components/TopBar";

export default function PersonasPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [usingFixtures, setUsingFixtures] = useState(false);
  const [currentPersonaName, setCurrentPersonaName] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    getPersonas().then((list) => {
      if (cancelled) return;
      if (list.length > 0) {
        setPersonas(list);
        setUsingFixtures(false);
      } else {
        setPersonas(FIXTURE_PERSONAS);
        setUsingFixtures(true);
      }
    });
    setCurrentPersonaName(readCookie(PERSONA_COOKIE));
    return () => {
      cancelled = true;
    };
  }, []);

  const totalParcels = personas.reduce(
    (max, p) => Math.max(max, p.visible_parcels ?? 0),
    0
  );

  async function handleViewAs(personaId: string) {
    const result = await loginPersona(personaId);
    if (!result) return;
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
    window.location.href = "/console";
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Who sees what
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Every login is scoped to a jurisdiction and a role. The console
            doesn&apos;t hide buttons — the backend refuses out-of-scope data
            and illegal actions. Pick a persona to experience their exact
            view.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {personas.map((persona) => (
            <PersonaCard
              key={persona.id}
              persona={persona}
              totalParcels={totalParcels}
              isActive={currentPersonaName === persona.name}
              onViewAs={usingFixtures ? undefined : handleViewAs}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
