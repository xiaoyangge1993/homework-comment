import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PassButton } from "@/components/PassButton";
import { ReviewPanel } from "@/components/ReviewPanel";
import { SentenceEditor } from "@/components/SentenceEditor";
import { getAssignment, type AssignmentDetail } from "@/lib/assignments";
import { AppError, visibleError } from "@/lib/errors";
import { referenceHint } from "@/lib/reference-hint";

export default async function AssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ submission?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();
  let detail;
  try {
    detail = await getAssignment(numericId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    if (error instanceof AppError) return <p className="error">{error.message}</p>;
    console.error(error);
    return <p className="error">{visibleError(error)}</p>;
  }

  if (detail.status === "draft") {
    return (
      <>
        <h1>{detail.title}</h1>
        <p className="muted">草稿。先上传或录制整段布置视频。逐句标准音可以不录。句子都有英文、且都不超过 30 个词，才能发布。</p>
        <SentenceEditor assignmentId={detail.id} initial={detail.sentences} demoVideoUrl={detail.demoVideoUrl} />
      </>
    );
  }

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const link = host ? `${proto}://${host}/s/${detail.id}` : `/s/${detail.id}`;

  return (
    <>
      <h1>{detail.title}</h1>
      <p className="muted">{detail.status === "published" ? "已发布" : "已结束"}</p>
      {detail.demoVideoUrl ? (
        <section className="card">
          <p className="muted">布置视频</p>
          <video controls playsInline preload="metadata" src={detail.demoVideoUrl} />
        </section>
      ) : null}
      <ReferenceHint detail={detail} />
      {detail.joinCode ? (
        <section className="card">
          <p className="muted">班级码</p>
          <p className="code">{detail.joinCode}</p>
          <p>
            作业链接 <a href={link}>{link}</a>
          </p>
        </section>
      ) : null}
      {query.submission ? (
        <TeacherReview assignmentId={detail.id} submissionId={Number(query.submission)} />
      ) : (
        <ClassBoard assignmentId={detail.id} />
      )}
    </>
  );
}

function ReferenceHint({ detail }: { detail: AssignmentDetail }) {
  const hint = referenceHint({
    sentenceCount: detail.sentences.length,
    missingReference: detail.sentences.filter((sentence) => !sentence.referenceUrl).length,
    hasDemoVideo: detail.hasDemoVideo,
  });
  return <p className={hint === "每句都有标准音" ? "ok" : "warn"}>{hint}</p>;
}

async function ClassBoard({ assignmentId }: { assignmentId: number }) {
  const { loadBoard } = await import("@/lib/review");
  const board = await loadBoard(assignmentId);
  return (
    <div className="grade-surface">
      <div className="stats">
        <div className="stat">
          <span className="muted">已交</span>
          <b>{board.submittedCount}</b>
        </div>
        <div className="stat">
          <span className="muted">建议亲听</span>
          <b>{board.listenCount}</b>
        </div>
        <div className="stat">
          <span className="muted">可一键通过</span>
          <b>{board.passCount}</b>
        </div>
      </div>
      {board.rows.length === 0 ? <p className="muted">还没有学生提交。</p> : null}
      {board.rows.length > 0 ? (
        <table className="board">
          <thead>
            <tr>
              <th>学生</th>
              <th className="num">准确度</th>
              <th className="num">完整度</th>
              <th className="num">流利度</th>
              <th>节奏</th>
              <th>建议</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row, index) => (
              <tr
                key={row.submissionId}
                data-group={row.group}
                className={
                  [
                    row.group === "listen" ? "is-listen" : "",
                    row.group === "pass" ? "is-pass" : "",
                    index > 0 && board.rows[index - 1].group !== row.group ? "group-start" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                <td data-label="学生">
                  <a href={`/teacher/assignments/${assignmentId}?submission=${row.submissionId}`}>{row.name}</a>
                </td>
                <td className="num" data-label="准确度">
                  {row.accuracyText}
                </td>
                <td className="num" data-label="完整度">
                  {row.completionText}
                </td>
                <td className="num" data-label="流利度">
                  {row.fluencyText}
                </td>
                <td data-label="节奏">{row.rhythmText}</td>
                <td data-label="建议">
                  <span className={row.group === "listen" ? "pill listen" : row.group === "pass" ? "pill pass" : "pill"}>
                    {row.advice}
                  </span>
                </td>
                <td className="board-action">{row.group === "pass" ? <PassButton submissionId={row.submissionId} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

async function TeacherReview({ assignmentId, submissionId }: { assignmentId: number; submissionId: number }) {
  if (!Number.isInteger(submissionId)) notFound();
  const { loadReview } = await import("@/lib/review");
  const { ttsConfigured } = await import("@/lib/tts");
  let review;
  try {
    review = await loadReview(assignmentId, submissionId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    if (error instanceof AppError) return <p className="error">{error.message}</p>;
    console.error(error);
    return <p className="error">{visibleError(error)}</p>;
  }
  return (
    <div className="grade-surface">
      <p>
        <a href={`/teacher/assignments/${assignmentId}`}>返回看板</a>
      </p>
      <h2 className="review-name">{review.studentName}</h2>
      {review.decision === "accepted" ? <p className="ok">已通过。学生能看到最终点评。</p> : null}
      {review.decision === "returned" ? <p className="warn">已打回。学生只能重录被选中的句子。</p> : null}
      {review.ttsUrl ? <audio controls preload="none" src={review.ttsUrl} /> : null}
      <ReviewPanel
        submissionId={review.submissionId}
        draftText={review.draftText}
        sentences={review.sentences}
        speechReady={ttsConfigured()}
      />
    </div>
  );
}
