"use client";

import { presentSentence } from "@/lib/soe-parse";

export function MarkedSentence({
  text,
  rawJson,
  onSeek,
}: {
  text: string;
  rawJson: string | null;
  onSeek?: (seconds: number) => void;
}) {
  const presented = presentSentence(text, rawJson);
  return (
    <>
      <p className="sentence-en">
        {presented.marks.map((mark, index) => {
          const seekable =
            Boolean(onSeek) && (mark.kind === "miss" || mark.kind === "wrong") && typeof mark.beginMs === "number";
          const className = mark.kind === "miss" || mark.kind === "wrong" || mark.kind === "oov" ? `mark-${mark.kind}` : undefined;
          if (!seekable || mark.beginMs == null) {
            return (
              <span key={index} className={className}>
                {mark.text}
              </span>
            );
          }
          return (
            <button
              key={index}
              type="button"
              className={`mark-jump ${className ?? ""}`.trim()}
              title="跳到这个词"
              onClick={() => onSeek?.(mark.beginMs! / 1000)}
            >
              {mark.text}
            </button>
          );
        })}
      </p>
      {presented.extras.length > 0 ? <p>多读：{presented.extras.join("、")}</p> : null}
    </>
  );
}
