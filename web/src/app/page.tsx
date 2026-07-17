import Link from "next/link";

const DEMO_METRICS = [
  { value: "30", label: "Monitored parcels" },
  { value: "6", label: "Taluks in view" },
  { value: "10", label: "Prioritized alerts" },
  { value: "5", label: "Due-process cases" },
];

const WORKFLOW_STEPS = [
  {
    number: "01",
    label: "Detect",
    title: "See meaningful change",
    description:
      "Satellite screening finds probable physical change across the public estate before it becomes invisible in paperwork.",
  },
  {
    number: "02",
    label: "Prioritize",
    title: "Put risk in context",
    description:
      "Parcel category, boundary confidence, severity, and local context turn raw signals into a reviewable work queue.",
  },
  {
    number: "03",
    label: "Verify",
    title: "Send officers prepared",
    description:
      "Inspectors see the parcel record, imagery history, lineage, and evidence requirements before they go to the field.",
  },
  {
    number: "04",
    label: "Act",
    title: "Move through due process",
    description:
      "Every notice, hearing, order, pause, and closure follows an explicit state transition with an auditable trail.",
  },
];

const CAPABILITIES = [
  {
    eyebrow: "Command map",
    title: "One operating picture, scoped to the officer",
    description:
      "See land categories, active alerts, and case pressure together—without exposing records outside the signed-in jurisdiction.",
    detail: "Map + work queue + role-aware KPIs",
    accent: "bg-[#dff7f0] text-[#09644e]",
  },
  {
    eyebrow: "Parcel intelligence",
    title: "A durable identity for land that changes over time",
    description:
      "Keep ULPIN and survey aliases, boundary grade, split or merge history, contextual trends, linked alerts, and cases on one record.",
    detail: "Lineage + provenance + context",
    accent: "bg-[#e9efff] text-[#284ea3]",
  },
  {
    eyebrow: "Case workflow",
    title: "Make the next lawful action obvious",
    description:
      "Plain-language actions expose only permitted transitions and the exact evidence required to move a case forward.",
    detail: "11-step chain + evidence gates",
    accent: "bg-[#fff1df] text-[#9a4d00]",
  },
];

const ROLE_CARDS = [
  {
    role: "Enforcement officer",
    focus: "Urgent alerts, active cases, and the next action that can move today.",
  },
  {
    role: "Survey officer",
    focus: "Weak boundaries, survey-paused cases, and cadastral confidence upgrades.",
  },
  {
    role: "State leadership",
    focus: "Estate-wide risk, jurisdiction performance, and due-process movement.",
  },
];

function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className={`relative grid h-8 w-8 place-items-center rounded-lg border ${
          inverse
            ? "border-white/20 bg-white/10"
            : "border-[#b9c9c2] bg-white"
        }`}
      >
        <span
          className={`h-3.5 w-3.5 rotate-12 rounded-[3px] border-2 ${
            inverse ? "border-[#76dfbf]" : "border-[#11735c]"
          }`}
        />
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#ec8e32]" />
      </span>
      <span className="text-[15px] font-bold tracking-[-0.02em]">mapencroach</span>
    </span>
  );
}

function HeroConsolePreview() {
  return (
    <div
      aria-label="Illustrative preview of the Haridwar–Roorkee command map"
      className="relative mx-auto w-full max-w-[660px]"
    >
      <div className="absolute -inset-5 -z-10 rounded-[2rem] bg-[#87cbb5]/20 blur-3xl" />
      <div className="overflow-hidden rounded-[1.35rem] border border-white/70 bg-white shadow-[0_30px_90px_rgba(7,35,31,0.20)]">
        <div className="flex h-11 items-center justify-between border-b border-[#d9e4df] bg-[#0d332d] px-4 text-white">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#69dbb2] shadow-[0_0_0_4px_rgba(105,219,178,0.15)]" />
            <span className="text-[11px] font-semibold tracking-wide">
              HARIDWAR–ROORKEE · LIVE DEMO
            </span>
          </div>
          <span className="rounded-full border border-white/15 px-2 py-1 text-[9px] text-white/70">
            CASE OFFICER
          </span>
        </div>
        <div className="grid min-h-[390px] grid-cols-[150px_1fr] sm:grid-cols-[190px_1fr]">
          <div className="border-r border-[#d9e4df] bg-[#f7faf8] p-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#788982]">
              Priority queue
            </p>
            <div className="mt-3 rounded-lg border border-[#f1c9bd] bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-[#fde5df] px-2 py-1 text-[8px] font-bold text-[#a82d1d]">
                  RED
                </span>
                <span className="text-[9px] font-bold text-[#a82d1d]">92</span>
              </div>
              <p className="mt-2 text-[11px] font-bold text-[#19302b]">SN-101</p>
              <p className="mt-1 text-[9px] leading-4 text-[#6d7f78]">
                Waterbody · Grade A
              </p>
            </div>
            <div className="mt-2 rounded-lg border border-[#eadac1] bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-[#fff2dc] px-2 py-1 text-[8px] font-bold text-[#955509]">
                  AMBER
                </span>
                <span className="text-[9px] font-bold text-[#955509]">61</span>
              </div>
              <p className="mt-2 text-[11px] font-bold text-[#19302b]">SN-103</p>
              <p className="mt-1 text-[9px] text-[#6d7f78]">Forest · Grade C</p>
            </div>
            <div className="mt-3 border-t border-[#dde7e2] pt-3">
              <div className="flex items-center justify-between text-[9px] text-[#6d7f78]">
                <span>Active cases</span>
                <strong className="text-[#19302b]">4</strong>
              </div>
              <div className="mt-2 flex items-center justify-between text-[9px] text-[#6d7f78]">
                <span>Paused</span>
                <strong className="text-[#19302b]">2</strong>
              </div>
            </div>
          </div>
          <div className="landing-map relative overflow-hidden bg-[#dce7df]">
            <div className="absolute left-[12%] top-[17%] h-20 w-24 rotate-[-8deg] rounded-[18%] border-2 border-[#147d62] bg-[#46b88b]/50" />
            <div className="absolute left-[42%] top-[9%] h-24 w-32 rotate-[6deg] rounded-[22%] border-2 border-[#b47417] bg-[#efbd61]/60" />
            <div className="absolute bottom-[17%] left-[26%] h-24 w-36 rotate-[3deg] rounded-[18%] border-2 border-[#2570a8] bg-[#60a9d7]/50" />
            <div className="absolute bottom-[10%] right-[10%] h-28 w-28 rotate-[-10deg] rounded-[20%] border-2 border-[#147d62] bg-[#46b88b]/40" />
            <div className="absolute right-[19%] top-[33%] h-24 w-20 rotate-[9deg] rounded-[16%] border-2 border-[#7a5aa6] bg-[#aa8ec8]/50" />
            <div className="absolute left-[37%] top-[43%] h-4 w-4 rounded-full border-[3px] border-white bg-[#c83925] shadow-[0_0_0_5px_rgba(200,57,37,0.18)]" />
            <div className="absolute right-[26%] top-[26%] h-3.5 w-3.5 rounded-full border-[3px] border-white bg-[#c4861d] shadow-md" />
            <div className="absolute bottom-[24%] left-[18%] h-3 w-3 rounded-full border-2 border-white bg-[#7c45a6] shadow-md" />
            <div className="absolute bottom-4 right-4 w-[172px] rounded-xl border border-[#d8e3dd] bg-white/95 p-3 shadow-lg backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-[#a82d1d]">URGENT ALERT</span>
                <span className="text-[9px] text-[#71827b]">ALT-001</span>
              </div>
              <p className="mt-1.5 text-[11px] font-bold text-[#19302b]">
                Probable change on canal bank
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#edf2ef]">
                <div className="h-full w-[92%] rounded-full bg-[#c83925]" />
              </div>
              <p className="mt-1 text-[8px] text-[#71827b]">
                Severity 92 · field review required
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-6 left-6 hidden rounded-xl border border-[#d7e3dd] bg-white px-4 py-3 shadow-xl sm:block">
        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#11735c]">
          Next lawful action
        </p>
        <p className="mt-1 text-xs font-bold text-[#18312b]">Assign inspection</p>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f6f8f5] text-[#18312b]">
      <header className="sticky top-0 z-50 border-b border-[#dbe5df]/90 bg-[#f6f8f5]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            aria-label="mapencroach home"
            className="rounded-lg focus:outline-none focus:ring-2 focus:ring-[#11735c] focus:ring-offset-4"
          >
            <BrandMark />
          </Link>
          <nav aria-label="Landing" className="hidden items-center gap-7 md:flex">
            <a className="text-sm font-medium text-[#536a62] hover:text-[#18312b]" href="#how-it-works">
              How it works
            </a>
            <a className="text-sm font-medium text-[#536a62] hover:text-[#18312b]" href="#product">
              Product
            </a>
            <a className="text-sm font-medium text-[#536a62] hover:text-[#18312b]" href="#trust">
              Trust model
            </a>
          </nav>
          <Link
            href="/console"
            className="rounded-full bg-[#163d35] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#0e2f29] focus:outline-none focus:ring-2 focus:ring-[#11735c] focus:ring-offset-2 sm:px-5 sm:text-sm"
          >
            Open command map
          </Link>
        </div>
      </header>

      <main>
        <section className="landing-grid relative border-b border-[#dbe5df] px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20 lg:pt-24">
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[0.92fr_1.08fr] lg:gap-12 xl:gap-20">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#bdd3c9] bg-white/75 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#11735c] shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-[#ec8e32]" />
                Public land intelligence · built for government
              </div>
              <h1 className="mt-7 max-w-3xl text-4xl font-bold leading-[1.04] tracking-[-0.045em] text-[#102822] sm:text-6xl lg:text-[4.35rem]">
                See land risk early. Move every case lawfully.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-[#526a61] sm:text-lg sm:leading-8">
                Mapencroach connects satellite change signals, cadastral truth,
                field verification, and due process in one operating system for
                public land protection.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/console"
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-[#11735c] px-6 py-3.5 text-sm font-bold text-white shadow-[0_12px_30px_rgba(17,115,92,0.24)] transition hover:-translate-y-0.5 hover:bg-[#0c5e4b] focus:outline-none focus:ring-2 focus:ring-[#11735c] focus:ring-offset-2"
                >
                  Open command map
                  <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center rounded-full border border-[#b9c9c2] bg-white/70 px-6 py-3.5 text-sm font-bold text-[#24463d] transition hover:border-[#86a99b] hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#11735c] focus:ring-offset-2"
                >
                  See how it works
                </a>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-[#60756d]">
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#11735c]" />
                  Jurisdiction-scoped
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#11735c]" />
                  Human verified
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#11735c]" />
                  Audit ready
                </span>
              </div>
            </div>
            <HeroConsolePreview />
          </div>

          <dl className="mx-auto mt-20 grid max-w-7xl grid-cols-2 overflow-hidden rounded-2xl border border-[#d6e1db] bg-white/70 shadow-[0_16px_45px_rgba(28,62,52,0.06)] backdrop-blur sm:grid-cols-4">
            {DEMO_METRICS.map((metric, index) => (
              <div
                key={metric.label}
                className={`px-5 py-5 sm:px-7 sm:py-6 ${
                  index % 2 !== 0 ? "border-l border-[#dce6e1]" : ""
                } ${index > 1 ? "border-t border-[#dce6e1] sm:border-t-0" : ""} ${
                  index > 0 ? "sm:border-l" : ""
                }`}
              >
                <dd className="text-2xl font-bold tracking-[-0.03em] text-[#14352d] sm:text-3xl">
                  {metric.value}
                </dd>
                <dt className="mt-1 text-xs font-medium text-[#6a7d76] sm:text-sm">
                  {metric.label}
                </dt>
              </div>
            ))}
          </dl>
          <p className="mx-auto mt-3 max-w-7xl text-right text-[10px] uppercase tracking-[0.12em] text-[#7b8c85]">
            Seeded Haridwar–Roorkee demonstration
          </p>
        </section>

        <section id="how-it-works" className="scroll-mt-24 bg-white px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#11735c]">
                One operational chain
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] text-[#143029] sm:text-5xl">
                From signal to lawful action
              </h2>
              <p className="mt-5 text-base leading-7 text-[#5a7067] sm:text-lg">
                The product is designed around the work government actually has
                to complete—not around a model score in isolation.
              </p>
            </div>
            <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {WORKFLOW_STEPS.map((step, index) => (
                <article
                  key={step.number}
                  className="group relative overflow-hidden rounded-2xl border border-[#dbe5e0] bg-[#f8faf8] p-6 transition hover:-translate-y-1 hover:border-[#abc9bc] hover:shadow-[0_16px_40px_rgba(25,66,55,0.08)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-[0.16em] text-[#11735c]">
                      {step.label}
                    </span>
                    <span className="text-sm font-bold text-[#b4c3bd]">{step.number}</span>
                  </div>
                  <div className="mt-8 h-10 w-10 rounded-full border border-[#b9d0c6] bg-white p-2">
                    <div className="h-full w-full rounded-full bg-[#11735c]" style={{ opacity: 0.25 + index * 0.2 }} />
                  </div>
                  <h3 className="mt-6 text-lg font-bold tracking-[-0.02em] text-[#18332c]">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-[#60756d]">
                    {step.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="product" className="scroll-mt-24 border-y border-[#dbe5df] bg-[#eef3ef] px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="grid items-end gap-6 lg:grid-cols-[1fr_0.65fr]">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#11735c]">
                  Built around the parcel
                </p>
                <h2 className="mt-4 max-w-3xl text-3xl font-bold tracking-[-0.035em] text-[#143029] sm:text-5xl">
                  One record from first alert to final closure
                </h2>
              </div>
              <p className="text-base leading-7 text-[#5a7067]">
                Every screen answers a practical question: what changed, where,
                how reliable is the boundary, what evidence exists, and what can
                the officer legally do next?
              </p>
            </div>
            <div className="mt-14 grid gap-5 lg:grid-cols-3">
              {CAPABILITIES.map((capability, index) => (
                <article
                  key={capability.title}
                  className={`rounded-[1.5rem] border border-[#d4e0da] bg-white p-7 shadow-[0_14px_40px_rgba(24,59,49,0.05)] ${
                    index === 1 ? "lg:-translate-y-4" : ""
                  }`}
                >
                  <span className={`inline-flex rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${capability.accent}`}>
                    {capability.eyebrow}
                  </span>
                  <h3 className="mt-7 text-xl font-bold leading-7 tracking-[-0.025em] text-[#19352d]">
                    {capability.title}
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-[#60756d]">
                    {capability.description}
                  </p>
                  <div className="mt-8 border-t border-[#e0e8e4] pt-4 text-xs font-bold text-[#365c50]">
                    {capability.detail}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="trust" className="scroll-mt-24 bg-[#0d332d] px-5 py-20 text-white sm:px-8 sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#70dab7]">
                The trust boundary
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] sm:text-5xl">
                Prioritize with context. Enforce with evidence.
              </h2>
              <p className="mt-6 max-w-xl text-base leading-7 text-white/70 sm:text-lg">
                Satellite signals and socioeconomic context help decide where to
                look. They never establish ownership, boundaries, or
                encroachment. Those conclusions remain grounded in cadastral
                records, surveys, inspection, and due process.
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {["Context ≠ evidence", "Officer in the loop", "Source provenance", "Explicit case gates"].map((item) => (
                  <span key={item} className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-[1.5rem] border border-white/15 bg-white/[0.06] p-5 shadow-2xl backdrop-blur sm:p-7">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div className="rounded-xl border border-[#70dab7]/25 bg-[#70dab7]/10 p-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7be0bd]">
                    Screening layer
                  </p>
                  <p className="mt-3 text-lg font-bold">Probable change</p>
                  <ul className="mt-4 space-y-2 text-xs text-white/60">
                    <li>Satellite observations</li>
                    <li>Contextual trends</li>
                    <li>Priority scoring</li>
                  </ul>
                </div>
                <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-sm text-white/70 sm:rotate-0">
                  →
                </div>
                <div className="rounded-xl border border-[#f1a55b]/25 bg-[#f1a55b]/10 p-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#f5b878]">
                    Enforcement layer
                  </p>
                  <p className="mt-3 text-lg font-bold">Verified finding</p>
                  <ul className="mt-4 space-y-2 text-xs text-white/60">
                    <li>Authoritative cadastre</li>
                    <li>Field inspection</li>
                    <li>Evidence-backed action</li>
                  </ul>
                </div>
              </div>
              <p className="mt-5 text-center text-[11px] font-semibold text-white/50">
                The system keeps these layers visibly and structurally separate.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#11735c]">
                One system, different work
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] text-[#143029] sm:text-5xl">
                Every role sees what matters now
              </h2>
            </div>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {ROLE_CARDS.map((card, index) => (
                <article key={card.role} className="rounded-2xl border border-[#dbe5df] bg-[#f8faf8] p-6">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#e2efe9] text-xs font-bold text-[#11735c]">
                    {index + 1}
                  </span>
                  <h3 className="mt-6 text-lg font-bold text-[#19352d]">{card.role}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#60756d]">{card.focus}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 pb-20 sm:px-8 sm:pb-28">
          <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[#e6f2ec] px-6 py-12 text-center sm:px-12 sm:py-16">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#11735c]">
              Explore the working demonstration
            </p>
            <h2 className="mx-auto mt-4 max-w-3xl text-3xl font-bold tracking-[-0.035em] text-[#143029] sm:text-5xl">
              Start with the risk. Follow it all the way to action.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-[#5b7168]">
              Open the Haridwar–Roorkee demo, choose an officer role, and move
              from a live alert to its parcel record and case workflow.
            </p>
            <Link
              href="/console"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#11735c] px-7 py-3.5 text-sm font-bold text-white shadow-[0_12px_30px_rgba(17,115,92,0.22)] transition hover:-translate-y-0.5 hover:bg-[#0c5e4b] focus:outline-none focus:ring-2 focus:ring-[#11735c] focus:ring-offset-2"
            >
              Open command map
              <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#dbe5df] bg-[#f6f8f5] px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <BrandMark />
          <p className="max-w-xl text-xs leading-5 text-[#6b7e77] sm:text-right">
            Encroachment intelligence and case management for Indian state governments.
            Demo data only.
          </p>
        </div>
      </footer>
    </div>
  );
}
