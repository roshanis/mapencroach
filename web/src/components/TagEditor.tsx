"use client";

import { useState } from "react";
import { addParcelTag, removeParcelTag } from "@/lib/api";

export interface TagEditorProps {
  parcelId: string;
  initialTags: string[];
}

export function TagEditor({ parcelId, initialTags }: TagEditorProps) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const tag = input.trim();
    if (!tag) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await addParcelTag(parcelId, tag);
      if (result.ok) {
        setTags(result.tags ?? tags);
        setInput("");
      } else {
        setError(`Refused (HTTP ${result.status}): ${result.detail}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(tag: string) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await removeParcelTag(parcelId, tag);
      if (result.ok) {
        setTags(result.tags ?? tags);
      } else {
        setError(`Refused (HTTP ${result.status}): ${result.detail}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-testid="tag-editor" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            data-testid="tag-chip"
            className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
          >
            {tag}
            <button
              type="button"
              data-testid={`tag-remove-${tag}`}
              onClick={() => handleRemove(tag)}
              disabled={submitting}
              className="text-gray-400 hover:text-gray-700 disabled:opacity-50"
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          data-testid="tag-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="add-tag-like-this"
          disabled={submitting}
          className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
        />
        <button
          type="button"
          data-testid="tag-add"
          onClick={handleAdd}
          disabled={submitting}
          className="rounded bg-gov px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Add tag
        </button>
      </div>

      {error && (
        <p data-testid="tag-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
