import type { Metadata } from "next";
import { LegalPage, Section, Unpublished } from "@/components/LegalPage";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Terms and conditions",
  description:
    "The terms on which this application is made available, including the limits of what its outputs establish.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  const { organisation, postalAddress, contactEmail } = siteConfig;

  return (
    <LegalPage title="Terms and conditions" updated="13 September 2026">
      <p>
        These terms govern use of the mapencroach web application. By using it
        you accept them.
      </p>

      <Section heading="Who provides this service">
        <p>
          {organisation ? (
            <strong>{organisation}</strong>
          ) : (
            <Unpublished what="Operating entity" />
          )}{" "}
          provides this service.{" "}
          {postalAddress ? (
            <span className="whitespace-pre-line">{postalAddress}</span>
          ) : (
            <Unpublished what="Registered address" />
          )}
          {contactEmail ? (
            <>
              {" "}
              Contact:{" "}
              <a className="text-gov underline underline-offset-2" href={`mailto:${contactEmail}`}>
                {contactEmail}
              </a>
              .
            </>
          ) : null}
        </p>
      </Section>

      <Section heading="What the outputs are, and are not">
        <p>
          This is the term that matters most, and it restates what the software
          itself enforces rather than adding a disclaimer on top of it.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            A satellite alert indicates <strong>probable</strong> change on
            government land. It is not a finding of encroachment, not proof of
            unlawful occupation, and not a basis for enforcement on its own.
          </li>
          <li>
            Imagery cloud and shadow checks are a screening rule applied to
            classified pixels. A parcel passing that rule does not establish
            perfect cloud detection, ground truth, or legal evidence.
          </li>
          <li>
            Parcel geometry displayed here is not a cadastral record. The
            authoritative record, a survey, and field inspection control any
            finding.
          </li>
          <li>
            Notice drafts produced by the application are clearly marked
            training drafts. They are not approved forms and are not for
            service. Evidence packets are unsigned and explicitly pending legal
            review.
          </li>
          <li>
            Analytical grid cells are an index for screening and aggregation.
            They are not parcel or cadastral boundaries.
          </li>
        </ul>
      </Section>

      <Section heading="Authorised use">
        <p>
          Access is granted to named officers within a defined jurisdiction.
          You may not attempt to reach records outside your jurisdiction, share
          credentials, or use the service to make an enforcement decision
          without the verification steps the law requires.
        </p>
      </Section>

      <Section heading="Availability">
        <p>
          The service is provided without a guarantee of uninterrupted
          availability. Demonstration deployments may reset their data at any
          time, and any change made in a demonstration is not preserved.
        </p>
      </Section>

      <Section heading="Liability">
        <p>
          To the extent permitted by law, the operator is not liable for loss
          arising from reliance on an output of this service in place of the
          cadastral record, a survey, field inspection, or legal advice.
          Nothing in these terms limits liability that cannot lawfully be
          limited.
        </p>
      </Section>

      <Section heading="Governing law">
        <p>
          Governing law and jurisdiction:{" "}
          <Unpublished what="Governing law" />. This must be set by the
          operating entity before the service is offered publicly.
        </p>
      </Section>
    </LegalPage>
  );
}
