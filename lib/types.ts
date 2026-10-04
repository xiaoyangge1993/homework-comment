export type SentenceDTO = {
  id: number;
  idx: number;
  textEn: string;
  textZh: string;
  wordCount: number;
  tooLong: boolean;
  referenceUrl: string | null;
};

export type AssignmentStatus = "draft" | "published" | "closed";
export type SubmissionStatus = "partial" | "submitted" | "returned" | "accepted";
export type RhythmLabel = "接近" | "偏快" | "偏慢" | "停顿偏长";
export type TextMark = {
  text: string;
  kind: "plain" | "match" | "miss" | "wrong" | "oov";
  beginMs?: number | null;
  endMs?: number | null;
};

export type ReviewSentence = {
  id: number;
  index: number;
  textEn: string;
  textZh: string;
  referenceUrl: string | null;
  needsListen: boolean;
  attempt: AttemptView | null;
};

export type AttemptView = {
  id: number;
  sentenceId: number;
  audioUrl: string | null;
  videoUrl: string | null;
  accuracy: number | null;
  fluency: number | null;
  completion: number | null;
  rhythm: RhythmLabel | null;
  rawJson: string | null;
  createdAt: string;
};

export type StudentAssignmentView = {
  id: number;
  title: string;
  status: "published" | "closed";
  classId: number;
  demoVideoUrl: string | null;
  sentences: {
    id: number;
    idx: number;
    textEn: string;
    textZh: string;
    referenceUrl: string | null;
    attempt: AttemptView | null;
  }[];
  submission: {
    id: number;
    status: SubmissionStatus;
    returnedSentenceIds: number[];
  } | null;
  review: {
    draftText: string | null;
    finalText: string | null;
    decision: "accepted" | "returned" | null;
    ttsUrl: string | null;
  } | null;
};
