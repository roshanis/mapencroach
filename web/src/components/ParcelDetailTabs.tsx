"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

interface ParcelDetailTabsProps {
  overview: ReactNode;
  context: ReactNode;
}

const TAB_IDS = ["overview", "context"] as const;
type TabId = (typeof TAB_IDS)[number];

export function ParcelDetailTabs({ overview, context }: ParcelDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function activateByIndex(index: number) {
    const nextIndex = (index + TAB_IDS.length) % TAB_IDS.length;
    setActiveTab(TAB_IDS[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      activateByIndex(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      activateByIndex(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      activateByIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      activateByIndex(TAB_IDS.length - 1);
    }
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Parcel record sections"
        className="mb-6 flex gap-1 border-b border-slate-200"
      >
        {TAB_IDS.map((tab, index) => {
          const selected = activeTab === tab;
          const label = tab === "overview" ? "Overview" : "Context";
          return (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`parcel-${tab}-tab`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`parcel-${tab}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                selected
                  ? "border-gov text-gov"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        id="parcel-overview-panel"
        role="tabpanel"
        aria-labelledby="parcel-overview-tab"
        hidden={activeTab !== "overview"}
        className="flex flex-col gap-6"
      >
        {overview}
      </div>
      <div
        id="parcel-context-panel"
        role="tabpanel"
        aria-labelledby="parcel-context-tab"
        hidden={activeTab !== "context"}
      >
        {context}
      </div>
    </div>
  );
}
