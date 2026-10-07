CREATE TABLE IF NOT EXISTS teacher (
  id INTEGER PRIMARY KEY,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS class (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  join_code TEXT
);

CREATE TABLE IF NOT EXISTS assignment (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES class(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'closed')),
  created_at TEXT NOT NULL,
  demo_video_path TEXT,
  demo_audio_path TEXT
);

CREATE TABLE IF NOT EXISTS sentence (
  id INTEGER PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignment(id),
  idx INTEGER NOT NULL,
  text_en TEXT NOT NULL,
  text_zh TEXT,
  reference_audio_path TEXT
);

CREATE TABLE IF NOT EXISTS student (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES class(id),
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submission (
  id INTEGER PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignment(id),
  student_id INTEGER NOT NULL REFERENCES student(id),
  status TEXT NOT NULL CHECK (status IN ('partial', 'submitted', 'returned', 'accepted')),
  updated_at TEXT NOT NULL,
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS sentence_attempt (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submission(id),
  sentence_id INTEGER NOT NULL REFERENCES sentence(id),
  audio_path TEXT,
  video_path TEXT,
  accuracy REAL,
  fluency REAL,
  completion REAL,
  rhythm TEXT,
  raw_json TEXT,
  intonation_status TEXT,
  teacher_final TEXT,
  student_final TEXT,
  contour_agreement REAL,
  intonation_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL UNIQUE REFERENCES submission(id),
  draft_text TEXT,
  final_text TEXT,
  tts_audio_path TEXT,
  decision TEXT CHECK (decision IS NULL OR decision IN ('accepted', 'returned')),
  sentence_ids_returned TEXT
);

CREATE INDEX IF NOT EXISTS idx_sentence_assignment ON sentence(assignment_id, idx);
CREATE INDEX IF NOT EXISTS idx_attempt_submission ON sentence_attempt(submission_id, sentence_id, id);
CREATE INDEX IF NOT EXISTS idx_student_class ON student(class_id, display_name);
