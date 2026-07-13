"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PERSONA_COOKIE, TOKEN_COOKIE } from "@/lib/api";
import { PERSONA_META_COOKIE, clearCookie, readCookie } from "@/lib/cookies";
import { jurisdictionLabel, roleLabel } from "@/lib/format";

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
      // fall through to the plain-name fallback below
    }
  }
  const name = readCookie(PERSONA_COOKIE);
  return name ? { name } : undefined;
}

export function ViewingAsBanner() {
  const [meta, setMeta] = useState<PersonaMeta | undefined>(undefined);

  useEffect(() => {
    setMeta(readPersonaMeta());
  }, []);

  if (!meta) return null;

  const details = [
    meta.role ? roleLabel(meta.role) : undefined,
    meta.jurisdiction_id
      ? jurisdictionLabel(meta.jurisdiction_id, meta.jurisdiction_name)
      : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  function handleExit() {
    clearCookie(TOKEN_COOKIE);
    clearCookie(PERSONA_COOKIE);
    clearCookie(PERSONA_META_COOKIE);
    window.location.reload();
  }

  return (
    <div
      data-testid="viewing-as-banner"
      className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900"
    >
      <span>
        Viewing as <b>{meta.name}</b>
        {details ? ` — ${details}` : ""}. Everything on screen is scoped to
        this persona.
      </span>
      <span className="flex items-center gap-3 whitespace-nowrap">
        <Link href="/personas" className="underline">
          All personas
        </Link>
        <button
          type="button"
          data-testid="exit-persona"
          onClick={handleExit}
          className="underline"
        >
          Exit persona
        </button>
      </span>
    </div>
  );
}
