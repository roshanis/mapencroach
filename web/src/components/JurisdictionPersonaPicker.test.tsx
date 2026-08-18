import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getPersonas, loginPersona, type Persona } from "@/lib/api";
import { PERSONA_META_COOKIE } from "@/lib/cookies";
import { JurisdictionPersonaPicker } from "./JurisdictionPersonaPicker";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("@/lib/api", () => ({
  getPersonas: vi.fn(),
  loginPersona: vi.fn(),
  TOKEN_COOKIE: "mapencroach_token",
  PERSONA_COOKIE: "mapencroach_persona",
}));

const LIVE_PERSONAS: Persona[] = [
  {
    id: "eo-haridwar",
    name: "Enforcement Officer, Haridwar",
    role: "case_officer",
    jurisdiction_id: "dist-a",
    jurisdiction_name: "Haridwar Division",
    authority_id: "state",
    authority_name: "Haridwar–Roorkee Development Authority",
    description: "Runs HRDA cases.",
  },
  {
    id: "co-ambalapuzha",
    name: "Taluk Officer, Ambalapuzha",
    role: "case_officer",
    jurisdiction_id: "taluk-ambalapuzha",
    jurisdiction_name: "Ambalapuzha Taluk",
    authority_id: "state-kl",
    authority_name: "Government of Kerala",
    description: "Runs Alappuzha cases.",
  },
  {
    id: "collector-alappuzha",
    name: "District Collector, Alappuzha",
    role: "viewer",
    jurisdiction_id: "dist-alappuzha",
    jurisdiction_name: "Alappuzha District",
    authority_id: "state-kl",
    authority_name: "Government of Kerala",
    description: "Views Alappuzha cases.",
  },
  {
    id: "co-haveli",
    name: "Taluk Officer, Haveli",
    role: "case_officer",
    jurisdiction_id: "taluk-haveli",
    jurisdiction_name: "Haveli Taluk",
    authority_id: "state-mh",
    authority_name: "Government of Maharashtra",
    description: "Runs Pune cases.",
  },
  {
    id: "collector-pune",
    name: "District Collector, Pune",
    role: "viewer",
    jurisdiction_id: "dist-pune",
    jurisdiction_name: "Pune District",
    authority_id: "state-mh",
    authority_name: "Government of Maharashtra",
    description: "Views Pune cases.",
  },
];

function clearCookies() {
  document.cookie = "mapencroach_token=; path=/; max-age=0";
  document.cookie = "mapencroach_persona=; path=/; max-age=0";
  document.cookie = `${PERSONA_META_COOKIE}=; path=/; max-age=0`;
}

async function choosePuneOfficer() {
  await waitFor(() => expect(getPersonas).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("combobox", { name: "Operating jurisdiction" }), {
    target: { value: "state-mh" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Persona" }), {
    target: { value: "co-haveli" },
  });
}

describe("JurisdictionPersonaPicker", () => {
  afterEach(() => {
    clearCookies();
    navigation.push.mockReset();
    navigation.refresh.mockReset();
    vi.restoreAllMocks();
  });

  it("lists all authorities and shows their represented districts or taluks", async () => {
    vi.mocked(getPersonas).mockResolvedValue(LIVE_PERSONAS);

    render(<JurisdictionPersonaPicker />);

    const jurisdiction = await screen.findByRole("combobox", {
      name: "Operating jurisdiction",
    });
    expect(jurisdiction).toHaveTextContent("Haridwar–Roorkee Development Authority");
    expect(jurisdiction).toHaveTextContent("Government of Kerala — Alappuzha District");
    expect(jurisdiction).toHaveTextContent("Government of Maharashtra — Pune District");
  });

  it("filters persona choices to the selected authority", async () => {
    vi.mocked(getPersonas).mockResolvedValue(LIVE_PERSONAS);

    render(<JurisdictionPersonaPicker />);
    await choosePuneOfficer();

    const persona = screen.getByRole("combobox", { name: "Persona" });
    expect(persona).toHaveTextContent("District Collector, Pune");
    expect(persona).toHaveTextContent("Taluk Officer, Haveli");
    expect(persona).not.toHaveTextContent("Taluk Officer, Ambalapuzha");
    expect(persona).not.toHaveTextContent("Enforcement Officer, Haridwar");
  });

  it("logs in, stores the scoped persona session, and opens the console", async () => {
    const puneOfficer = LIVE_PERSONAS.find((persona) => persona.id === "co-haveli")!;
    vi.mocked(getPersonas).mockResolvedValue(LIVE_PERSONAS);
    vi.mocked(loginPersona).mockResolvedValue({
      token: "pune-token",
      persona: puneOfficer,
    });

    render(<JurisdictionPersonaPicker />);
    await choosePuneOfficer();
    fireEvent.click(screen.getByRole("button", { name: "Enter command map" }));

    await waitFor(() => expect(loginPersona).toHaveBeenCalledWith("co-haveli"));
    expect(document.cookie).toContain("mapencroach_token=pune-token");
    expect(document.cookie).toContain("mapencroach_persona=Taluk%20Officer%2C%20Haveli");
    expect(document.cookie).toContain(`${PERSONA_META_COOKIE}=`);
    expect(navigation.push).toHaveBeenCalledWith("/console");
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("keeps the user on the landing page and explains a failed login", async () => {
    vi.mocked(getPersonas).mockResolvedValue(LIVE_PERSONAS);
    vi.mocked(loginPersona).mockResolvedValue(null);

    render(<JurisdictionPersonaPicker />);
    await choosePuneOfficer();
    fireEvent.click(screen.getByRole("button", { name: "Enter command map" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Persona login failed. Try again."
    );
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("shows fixture jurisdictions for orientation but does not pretend login works offline", async () => {
    vi.mocked(getPersonas).mockResolvedValue([]);

    render(<JurisdictionPersonaPicker />);

    expect(
      await screen.findByText("Connect the demo backend to enter the command map.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter command map" })).toBeDisabled();
    expect(loginPersona).not.toHaveBeenCalled();
  });
});
