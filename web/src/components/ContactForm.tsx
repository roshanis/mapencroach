"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { siteConfig } from "@/lib/site-config";

type FieldErrors = Partial<Record<"name" | "email" | "message", string>>;

/** Client-side checks only — the endpoint must validate independently. */
function validate(values: { name: string; email: string; message: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = "Enter your name.";
  if (!values.email.trim()) {
    errors.email = "Enter an email address we can reply to.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = "That does not look like an email address.";
  }
  if (!values.message.trim()) {
    errors.message = "Tell us what you need.";
  } else if (values.message.trim().length < 20) {
    errors.message = "Please add a little more detail (at least 20 characters).";
  }
  return errors;
}

/**
 * A contact form is a promise that someone will read what you wrote.
 *
 * It is therefore only rendered when there is somewhere for the message
 * to go. With no endpoint configured the page shows the mailbox instead
 * — a form that POSTs nowhere, or worse shows a thank-you page after
 * discarding the message, is the most direct form of lying to a user
 * this site could contain.
 */
export function ContactForm() {
  const router = useRouter();
  const [values, setValues] = useState({ name: "", email: "", message: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const response = await fetch(siteConfig.contactEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        // Say what actually happened. "Something went wrong" leaves the
        // sender unable to tell whether to retry or to use email instead.
        setSubmitError(
          response.status >= 500
            ? "The contact service is unavailable right now. Your message was not sent — please try again shortly, or email us directly."
            : "That message was refused. Your message was not sent — please check the fields and try again."
        );
        return;
      }
      router.push("/contact/thank-you");
    } catch {
      setSubmitError(
        "We could not reach the contact service. Your message was not sent — check your connection, or email us directly."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const field =
    "mt-1 block w-full rounded-md border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gov";

  return (
    <form onSubmit={handleSubmit} noValidate data-testid="contact-form" className="flex flex-col gap-5">
      {submitError && (
        <p
          role="alert"
          data-testid="contact-submit-error"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {submitError}
        </p>
      )}

      <label className="block">
        <span className="text-sm font-medium text-gray-900">Your name</span>
        <input
          type="text"
          name="name"
          value={values.name}
          autoComplete="name"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "contact-name-error" : undefined}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          className={`${field} ${errors.name ? "border-red-400" : "border-gray-300"}`}
        />
        {errors.name && (
          <span id="contact-name-error" role="alert" className="mt-1 block text-sm text-red-700">
            {errors.name}
          </span>
        )}
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-900">Email</span>
        <input
          type="email"
          name="email"
          value={values.email}
          autoComplete="email"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "contact-email-error" : undefined}
          onChange={(e) => setValues({ ...values, email: e.target.value })}
          className={`${field} ${errors.email ? "border-red-400" : "border-gray-300"}`}
        />
        {errors.email && (
          <span id="contact-email-error" role="alert" className="mt-1 block text-sm text-red-700">
            {errors.email}
          </span>
        )}
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-900">Message</span>
        <textarea
          name="message"
          rows={6}
          value={values.message}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? "contact-message-error" : undefined}
          onChange={(e) => setValues({ ...values, message: e.target.value })}
          className={`${field} ${errors.message ? "border-red-400" : "border-gray-300"}`}
        />
        {errors.message && (
          <span id="contact-message-error" role="alert" className="mt-1 block text-sm text-red-700">
            {errors.message}
          </span>
        )}
      </label>

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-gov px-5 py-2.5 text-sm font-semibold text-white hover:bg-gov-dark disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
