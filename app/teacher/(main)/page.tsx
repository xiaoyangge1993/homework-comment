import { listAssignments } from "@/lib/assignments";
import { AppError } from "@/lib/errors";
import { referenceHint } from "@/lib/reference-hint";

function hintSuffix(sentenceCount: number, missingReference: number, hasDemoVideo: boolean): string {
  const hint = referenceHint({ sentenceCount, missingReference, hasDemoVideo });
  return hint === "每句都有标准音" ? "" : ` · ${hint}`;
}

const statusLabel = {
  draft: "草稿",
  published: "已发布",
  closed: "已结束",
} as const;

export default async function TeacherHomePage() {
  let assignments;
  try {
    assignments = await listAssignments();
  } catch (error) {
    if (error instanceof AppError) return <p className="error">{error.message}</p>;
    throw error;
  }
  return (
    <>
      <div className="sentence-head assignments-head">
        <h1>作业</h1>
        <a className="btn primary" href="/teacher/assignments/new">
          布置新作业
        </a>
      </div>
      {assignments.length === 0 ? <p className="muted">还没有作业。</p> : null}
      <div className="stack">
        {assignments.map((assignment) => (
          <a key={assignment.id} className="card list-card" href={`/teacher/assignments/${assignment.id}`}>
            <div>
              <strong>{assignment.title}</strong>
              <p className="muted">
                {statusLabel[assignment.status]} · {assignment.sentence_count} 句
                {assignment.status !== "draft"
                  ? hintSuffix(assignment.sentence_count, assignment.missing_reference, assignment.has_demo === 1)
                  : ""}
                {assignment.join_code ? ` · 班级码 ${assignment.join_code}` : ""}
              </p>
            </div>
            <span>{new Date(assignment.created_at).toLocaleDateString("zh-CN")}</span>
          </a>
        ))}
      </div>
    </>
  );
}
