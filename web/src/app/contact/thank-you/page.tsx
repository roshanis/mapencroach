import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Section } from "@/components/LegalPage";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Message sent",
  description: "Confirmation that your message reached us.",
  // Reachable only after a successful submit. Indexing it would put a
  // "thanks for your message" page in search results for people who
  // never sent one.
  robots: { index: false, follow: false },
};

export default function ThankYouPage() {
  const { contactEmail } = siteConfig;

  return (
    <LegalPage title="Message sent" updated="13 September 2026">
      <Section heading="Thank you">
        <p data-testid="thank-you-confirmation">
          Your message reached us and a copy has gone to the address you gave.
          We read everything that arrives here.
        </p>
        <p>
          If you do not hear back and your message was time-sensitive,
          {contactEmail ? (
            <>
              {" "}
              write directly to{" "}
              <a className="text-gov underline underline-offset-2" href={`mailto:${contactEmail}`}>
                {contactEmail}
              </a>
              .
            </>
          ) : (
            " use the postal address on the contact page."
          )}
        </p>
        <p>
          <Link className="text-gov underline underline-offset-2" href="/">
            Back to the home page
          </Link>
        </p>
      </Section>
    </LegalPage>
  );
}
