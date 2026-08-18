"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getPersonas,
  loginPersona,
  PERSONA_COOKIE,
  TOKEN_COOKIE,
  type Persona,
} from "@/lib/api";
import { PERSONA_META_COOKIE, setCookie } from "@/lib/cookies";
import { FIXTURE_PERSONAS } from "@/lib/fixtures";

interface AuthorityGroup {
  id: string;
  name: string;
  representativeJurisdiction?: string;
  personas: Persona[];
}

function representativeJurisdiction(personas: Persona[], authorityName: string) {
  const names = Array.from(
    new Set(
      personas
        .map((persona) => persona.jurisdiction_name)
        .filter((name): name is string => Boolean(name) && name !== authorityName)
    )
  );
  return names.find((name) => name.endsWith("District")) ?? names[0];
}

export function groupPersonasByAuthority(personas: Persona[]): AuthorityGroup[] {
  const grouped = new Map<string, { name: string; personas: Persona[] }>();

  for (const persona of personas) {
    // Current demo responses carry explicit authority metadata. The fallback
    // keeps this component usable with older/single-authority fixture data
    // without ever merging unrelated jurisdictions into one group.
    const id = persona.authority_id ?? persona.jurisdiction_id;
    const name =
      persona.authority_name ?? persona.jurisdiction_name ?? persona.jurisdiction_id;
    const group = grouped.get(id);
    if (group) {
      group.personas.push(persona);
    } else {
      grouped.set(id, { name, personas: [persona] });
    }
  }

  return Array.from(grouped, ([id, group]) => ({
    id,
    name: group.name,
    representativeJurisdiction: representativeJurisdiction(group.personas, group.name),
    personas: group.personas,
  }));
}

function authorityLabel(group: AuthorityGroup) {
  return group.representativeJurisdiction
    ? `${group.name} — ${group.representativeJurisdiction}`
    : group.name;
}

function roleLabel(role: string) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function JurisdictionPersonaPicker() {
  const router = useRouter();
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [authorityId, setAuthorityId] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPersonas().then((livePersonas) => {
      if (cancelled) return;
      if (livePersonas.length > 0) {
        setPersonas(livePersonas);
        setBackendAvailable(true);
      } else {
        // Keep the landing page informative in fixture/offline mode, but do
        // not offer a fake login: only POST /demo/login can mint a real,
        // authority-scoped session.
        setPersonas(FIXTURE_PERSONAS);
        setBackendAvailable(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(
    () => groupPersonasByAuthority(personas ?? []),
    [personas]
  );
  const selectedGroup = groups.find((group) => group.id === authorityId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!backendAvailable || !personaId || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await loginPersona(personaId);
      if (!result) {
        setError("Persona login failed. Try again.");
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
      router.push("/console");
      router.refresh();
    } catch {
      setError("Persona login failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      id="demo-access"
      data-testid="jurisdiction-persona-picker"
      className="scroll-mt-20 border-b border-gray-200 bg-white px-5 py-20 sm:px-8 sm:py-24"
    >
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gov">
            Enter the live demo
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
            Choose your jurisdiction
          </h2>
          <p className="mt-5 text-base leading-7 text-gray-600">
            Start with the government authority, then choose an officer. The
            session receives only that persona&apos;s role and jurisdiction scope;
            selecting Pune never exposes Kerala or Haridwar–Roorkee records.
          </p>
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="rounded-2xl border border-gray-200 bg-gray-50 p-6 shadow-[0_16px_45px_rgba(15,23,42,0.07)] sm:p-8"
        >
          {personas === null ? (
            <p role="status" className="text-sm text-gray-600">
              Loading jurisdictions and personas…
            </p>
          ) : (
            <div className="grid gap-5">
              <label className="grid gap-2 text-sm font-semibold text-gray-800">
                Operating jurisdiction
                <select
                  value={authorityId}
                  onChange={(event) => {
                    setAuthorityId(event.target.value);
                    setPersonaId("");
                    setError(null);
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm font-normal text-gray-900 outline-none focus:border-gov focus:ring-2 focus:ring-gov/20"
                >
                  <option value="">Select a jurisdiction</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {authorityLabel(group)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-semibold text-gray-800">
                Persona
                <select
                  value={personaId}
                  disabled={!selectedGroup}
                  onChange={(event) => {
                    setPersonaId(event.target.value);
                    setError(null);
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm font-normal text-gray-900 outline-none focus:border-gov focus:ring-2 focus:ring-gov/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">Select an officer persona</option>
                  {selectedGroup?.personas.map((persona) => (
                    <option key={persona.id} value={persona.id}>
                      {persona.name} — {roleLabel(persona.role)} — {persona.jurisdiction_name}
                    </option>
                  ))}
                </select>
              </label>

              {selectedGroup && (
                <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-gov-dark">
                  {selectedGroup.personas.length} demo persona
                  {selectedGroup.personas.length === 1 ? "" : "s"} available for {selectedGroup.name}.
                </p>
              )}

              {!backendAvailable && (
                <p className="text-xs leading-5 text-amber-800">
                  Connect the demo backend to enter the command map.
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm font-medium text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!backendAvailable || !personaId || submitting}
                className="justify-self-start rounded-md bg-gov px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-gov-dark focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Opening command map…" : "Enter command map"}
              </button>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
