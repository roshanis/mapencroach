import type { Metadata } from "next";
import { ContactForm } from "@/components/ContactForm";
import { LegalPage, Section, Unpublished } from "@/components/LegalPage";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "How to reach the team operating this deployment about pilots, data protection requests, or the software itself.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  const { contactEmail, contactEndpoint, organisation, postalAddress } = siteConfig;

  return (
    <LegalPage title="Contact" updated="13 September 2026">
      <Section heading="Write to us">
        {contactEndpoint ? (
          <>
            <p>Send a message and we will reply to the address you give.</p>
            <ContactForm />
          </>
        ) : (
          <p data-testid="contact-no-form">
            There is no contact form on this deployment, because no destination
            has been configured for one — a form that quietly discarded your
            message would be worse than none.{" "}
            {contactEmail ? (
              <>
                Email{" "}
                <a className="text-gov underline underline-offset-2" href={`mailto:${contactEmail}`}>
                  {contactEmail}
                </a>{" "}
                instead.
              </>
            ) : (
              <>
                A contact mailbox has not been published yet:{" "}
                <Unpublished what="Contact mailbox" />
              </>
            )}
          </p>
        )}
      </Section>

      <Section heading="Postal address">
        <p>
          {organisation ? <strong>{organisation}</strong> : <Unpublished what="Operating entity" />}
          <br />
          {postalAddress ? (
            <span className="whitespace-pre-line">{postalAddress}</span>
          ) : (
            <Unpublished what="Registered address" />
          )}
        </p>
      </Section>

      <Section heading="Data protection requests">
        <p>
          Requests about personal data are handled through the contact in the{" "}
          <a className="text-gov underline underline-offset-2" href="/privacy">
            privacy policy
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
