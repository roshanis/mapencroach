import type { Metadata } from "next";
import { LegalPage, Section, Unpublished } from "@/components/LegalPage";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What this application stores in your browser, what it does not collect, and how to reach the operator about your data.",
  alternates: { canonical: "/privacy" },
};

/**
 * Written from what the code actually does, not from a template.
 *
 * Every claim below is checkable against source: the cookie names come
 * from `lib/cookies.ts` and `lib/api.ts`, the localStorage key from
 * `MapIntroPanel`, and "no analytics" from `components/Analytics.tsx`,
 * which loads nothing unless an id is configured. If any of those
 * change, this page is wrong and must change with them — a privacy
 * policy that drifts from the code is not a formality, it is a false
 * statement to the person relying on it.
 */
export default function PrivacyPolicyPage() {
  const { organisation, postalAddress, privacyEmail, analyticsId } = siteConfig;

  return (
    <LegalPage title="Privacy policy" updated="13 September 2026">
      <p>
        This policy covers the mapencroach web application. It describes what
        the application places in your browser and what it sends to its
        server. It is written to match the software as built; where a detail
        about the operator has not been published yet, that is shown plainly
        rather than filled in with an example.
      </p>

      <Section heading="Who operates this service">
        <p>
          {organisation ? (
            <strong>{organisation}</strong>
          ) : (
            <Unpublished what="Operating entity" />
          )}{" "}
          operates this deployment and is the controller for the data described
          here.
        </p>
        <p>
          Registered address:{" "}
          {postalAddress ? (
            <span className="whitespace-pre-line">{postalAddress}</span>
          ) : (
            <Unpublished what="Registered address" />
          )}
        </p>
        <p>
          Data protection contact:{" "}
          {privacyEmail ? (
            <a className="text-gov underline underline-offset-2" href={`mailto:${privacyEmail}`}>
              {privacyEmail}
            </a>
          ) : (
            <Unpublished what="Data protection mailbox" />
          )}
        </p>
      </Section>

      <Section heading="Cookies this application sets">
        <p>
          Only cookies that are strictly necessary to keep you signed in. There
          are no advertising cookies and no cross-site trackers.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <code className="rounded bg-gray-200 px-1">mapencroach_token</code> —
            your session token. Without it the application cannot tell which
            jurisdiction you are authorised to see. Expires after 8 hours.
          </li>
          <li>
            <code className="rounded bg-gray-200 px-1">mapencroach_persona</code>{" "}
            and{" "}
            <code className="rounded bg-gray-200 px-1">
              mapencroach_persona_meta
            </code>{" "}
            — which demonstration role you are viewing as, and its display name.
            Same 8-hour lifetime.
          </li>
        </ul>
        <p>
          Because these are strictly necessary to deliver a service you have
          asked for, they are set without a consent prompt. You can clear them
          at any time in your browser, or by using “Exit persona”; doing so
          signs you out.
        </p>
      </Section>

      <Section heading="Other browser storage">
        <p>
          The application stores one preference in your browser’s local storage:
          whether you have dismissed the “What am I looking at?” panel on the
          map. It never leaves your device and is not read by the server.
        </p>
      </Section>

      <Section heading="Analytics">
        {analyticsId ? (
          <p>
            This deployment loads an analytics script, and only after you accept
            it in the cookie notice. Declining means no analytics script is
            loaded and no analytics cookie is written.
          </p>
        ) : (
          <p>
            This deployment loads <strong>no analytics and no third-party
            tracking scripts at all</strong>. No measurement id is configured, so
            nothing is loaded, no analytics cookie is written, and no usage
            beacon is sent. If that changes, this section and the cookie notice
            change with it, and analytics would load only after you accept it.
          </p>
        )}
      </Section>

      <Section heading="What the server records">
        <p>
          When you act on a record — tagging a parcel, moving a case through a
          step, viewing retained imagery — the application writes an entry to a
          tamper-evident audit log containing your user identifier, the action,
          the record, and the time. This is a deliberate feature: land
          enforcement decisions must be attributable, and the log is part of the
          evidentiary record. It is not used for marketing or profiling.
        </p>
        <p>
          Ordinary web server request logs may also be retained by the hosting
          provider for operational and security purposes.
        </p>
      </Section>

      <Section heading="Demonstration data">
        <p>
          Where this deployment runs in demonstration mode, the parcels, alerts
          and cases shown are illustrative and do not describe real people,
          real landholdings or real enforcement proceedings.
        </p>
      </Section>

      <Section heading="Your rights">
        <p>
          You may request access to, correction of, or erasure of personal data
          held about you, subject to the retention duties that apply to
          evidentiary and audit records. Write to the data protection contact
          above. If no contact is published yet, this service is not ready to
          receive live personal data.
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          Material changes will be reflected here with a new “last updated”
          date.
        </p>
      </Section>
    </LegalPage>
  );
}
