import { describe, expect, it } from "vitest";
import { groupPersonasByAuthority } from "./DemoMenu";
import type { Persona } from "@/lib/api";

function persona(
  id: string,
  authority_id?: string | null,
  authority_name?: string | null
): Persona {
  return {
    id,
    name: `Persona ${id}`,
    role: "viewer",
    jurisdiction_id: "j",
    description: "",
    authority_id,
    authority_name,
  };
}

describe("groupPersonasByAuthority", () => {
  it("splits personas by authority and labels each group", () => {
    const groups = groupPersonasByAuthority([
      persona("a", "state", "HRDA"),
      persona("b", "state", "HRDA"),
      persona("c", "state-kl", "Government of Kerala"),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["HRDA", "Government of Kerala"]);
    expect(groups[0].personas.map((p) => p.id)).toEqual(["a", "b"]);
    expect(groups[1].personas.map((p) => p.id)).toEqual(["c"]);
  });

  it("shows no heading when every persona shares one authority", () => {
    // A single-authority console must look exactly as it did before
    // grouping existed -- a lone header over the whole list is noise.
    const groups = groupPersonasByAuthority([
      persona("a", "state", "HRDA"),
      persona("b", "state", "HRDA"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBeNull();
  });

  it("shows no heading when the backend reports no authority", () => {
    // Fixture data and older backends omit the field; they must not render
    // a group headed "undefined".
    const groups = groupPersonasByAuthority([persona("a"), persona("b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBeNull();
    expect(groups[0].personas).toHaveLength(2);
  });

  it("never drops or reorders a persona", () => {
    const input = [
      persona("a", "state", "HRDA"),
      persona("b", "state-kl", "Kerala"),
      persona("c", "state", "HRDA"),
    ];
    const flat = groupPersonasByAuthority(input).flatMap((g) => g.personas);
    expect(flat).toHaveLength(input.length);
    expect(new Set(flat.map((p) => p.id))).toEqual(new Set(["a", "b", "c"]));
    // Grouping reorders across groups by definition, but order *within* an
    // authority must survive: the demo script depends on the first entry.
    expect(
      flat.filter((p) => p.authority_id === "state").map((p) => p.id)
    ).toEqual(["a", "c"]);
  });

  it("handles an empty list", () => {
    expect(groupPersonasByAuthority([])).toEqual([]);
  });
});
