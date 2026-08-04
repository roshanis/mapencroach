"use client";

export function PrintPacketButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-gov px-4 py-2 text-sm font-semibold text-white hover:bg-gov-dark focus:outline-none focus:ring-2 focus:ring-gov focus:ring-offset-2"
    >
      Print or save as PDF
    </button>
  );
}
