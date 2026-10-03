"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { limits } from "@/lib/config";
import { countWords, pairSentences } from "@/lib/sentences";

export function NewAssignmentForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [textEn, setTextEn] = useState("");
  const [textZh, setTextZh] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const preview = useMemo(() => pairSentences(textEn, textZh), [textEn, textZh]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, textEn, textZh }),
      });
      const body = (await response.json()) as { id?: number; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error || "创建失败");
      router.push(`/teacher/assignments/${body.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败");
      setPending(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label>
        标题
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Unit 1 Pandas" required />
      </label>
      <label>
        课文英文
        <textarea
          className="passage"
          value={textEn}
          onChange={(event) => setTextEn(event.target.value)}
          placeholder="The pandas are black and white. They are cute. They like bamboo."
          required
        />
      </label>
      <label>
        中文释义（可选）
        <textarea value={textZh} onChange={(event) => setTextZh(event.target.value)} placeholder="熊猫是黑白的。它们很可爱。它们喜欢竹子。" />
      </label>
      {preview.length > 0 ? (
        <div className="stack">
          <p className="muted">拆成 {preview.length} 句。超过 {limits.maxWordsPerSentence} 个词的句子要再拆开才能发布。</p>
          {preview.map((sentence, index) => {
            const words = countWords(sentence.textEn);
            const long = words > limits.maxWordsPerSentence;
            return (
              <article key={`${sentence.textEn}-${index}`} className={long ? "card too-long" : "card"}>
                <div className="sentence-head">
                  <strong>第 {index + 1} 句</strong>
                  <span className="count">{words} 词</span>
                </div>
                <p className="sentence-en">{sentence.textEn}</p>
                {sentence.textZh ? <p className="muted">{sentence.textZh}</p> : null}
              </article>
            );
          })}
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? "创建中…" : "创建作业"}
      </button>
    </form>
  );
}
