export type IntonationStatus = "match" | "final_mismatch" | "flat" | "uncertain" | "skipped";
export type FinalDirection = "rise" | "fall" | "flat";

export type StoredIntonation = {
  status: IntonationStatus | null;
  teacherFinal: FinalDirection | null;
  studentFinal: FinalDirection | null;
  agreement: number | null;
  json: string | null;
};

const STATUSES: readonly IntonationStatus[] = ["match", "final_mismatch", "flat", "uncertain", "skipped"];
const DIRECTIONS: readonly FinalDirection[] = ["rise", "fall", "flat"];

export function isIntonationStatus(value: unknown): value is IntonationStatus {
  return typeof value === "string" && STATUSES.includes(value as IntonationStatus);
}

export function isFinalDirection(value: unknown): value is FinalDirection {
  return typeof value === "string" && DIRECTIONS.includes(value as FinalDirection);
}

export function intonationLabel(status: IntonationStatus | null, teacherFinal: FinalDirection | null): string | null {
  if (status === "match") return "语调一致";
  if (status === "flat") return "偏平";
  if (status === "uncertain") return "无法判断";
  if (status === "final_mismatch" && teacherFinal === "rise") return "句末应升";
  if (status === "final_mismatch" && teacherFinal === "fall") return "句末应降";
  return null;
}

export function intonationComment(
  index: number,
  status: IntonationStatus | null,
  teacherFinal: FinalDirection | null,
): string | null {
  if (status === "flat") return `第 ${index} 句语调偏平，试着跟上老师的起伏。`;
  if (status === "final_mismatch" && teacherFinal === "rise") return `第 ${index} 句末应跟上老师读成升调。`;
  if (status === "final_mismatch" && teacherFinal === "fall") return `第 ${index} 句末应跟上老师读成降调。`;
  return null;
}

export function firstIntonationComment(
  sentences: { index: number; intonationStatus: IntonationStatus | null; teacherFinal: FinalDirection | null }[],
): string | null {
  for (const sentence of sentences) {
    const line = intonationComment(sentence.index, sentence.intonationStatus, sentence.teacherFinal);
    if (line) return line;
  }
  return null;
}

export function readIntonationOutput(stdout: string): StoredIntonation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return failed("bad_json");
  }
  if (!parsed || typeof parsed !== "object") return failed("bad_json");
  const row = parsed as Record<string, unknown>;
  if (row.error === "parselmouth_missing") return emptyIntonation();
  if (row.ok === false) return failed(typeof row.error === "string" ? row.error : "failed");
  if (!isIntonationStatus(row.status) || row.status === "skipped") return failed("bad_status");
  const teacherFinal = row.teacherFinal == null ? null : isFinalDirection(row.teacherFinal) ? row.teacherFinal : undefined;
  const studentFinal = row.studentFinal == null ? null : isFinalDirection(row.studentFinal) ? row.studentFinal : undefined;
  if (teacherFinal === undefined || studentFinal === undefined) return failed("bad_direction");
  if (row.status === "final_mismatch" && teacherFinal !== "rise" && teacherFinal !== "fall") return failed("bad_direction");
  return {
    status: row.status,
    teacherFinal,
    studentFinal,
    agreement: agreementOf(row.contourAgreement),
    json: measurementOf(row.measurement),
  };
}

function agreementOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function measurementOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  return JSON.stringify(value);
}

export function emptyIntonation(): StoredIntonation {
  return { status: null, teacherFinal: null, studentFinal: null, agreement: null, json: null };
}

export function skippedIntonation(): StoredIntonation {
  return { status: "skipped", teacherFinal: null, studentFinal: null, agreement: null, json: null };
}

export function failed(reason: string): StoredIntonation {
  return { status: "uncertain", teacherFinal: null, studentFinal: null, agreement: null, json: JSON.stringify({ reason }) };
}
