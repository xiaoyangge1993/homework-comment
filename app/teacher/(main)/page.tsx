import { listAssignments } from "@/lib/assignments";

const statusLabel = {
  draft: "草稿",
  published: "已发布",
  closed: "已结束",
} as const;

export default function TeacherHomePage() {
  const assignments = listAssignments();
  return (
    <>
      <div className="sentence-head">
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
                {assignment.status !== "draft" && assignment.missing_reference > 0 ? " · 无节奏参照" : ""}
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
