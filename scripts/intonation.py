#!/usr/bin/env python3
"""Compare a student's pitch contour with the teacher's sentence recording.

The script prints one JSON object. It never decides pass or fail.
"""

import json
import math
import struct
import sys
import wave

PITCH_FLOOR = 120.0
PITCH_CEILING = 500.0
TIME_STEP = 0.01
MIN_VOICED = 8
FINAL_WINDOW = 0.3
FINAL_SEMITONES = 1.0
FLAT_RANGE = 2.0
MAX_ALIGN = 400


def can_import():
    try:
        import parselmouth  # noqa: F401
    except Exception:
        return False
    return True


def median(values):
    ordered = sorted(values)
    count = len(ordered)
    if count == 0:
        return None
    mid = count // 2
    if count % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def voiced_hz(path):
    import parselmouth

    sound = parselmouth.Sound(path)
    pitch = sound.to_pitch(time_step=TIME_STEP, pitch_floor=PITCH_FLOOR, pitch_ceiling=PITCH_CEILING)
    points = []
    for time in pitch.xs():
        value = pitch.get_value_at_time(time)
        if value is None:
            continue
        hz = float(value)
        if math.isnan(hz) or hz <= 0:
            continue
        points.append((float(time), hz))
    return points


def load_semitones(path):
    hz_points = voiced_hz(path)
    center = median([hz for _, hz in hz_points])
    if not center or center <= 0:
        return [], len(hz_points), None
    points = [(time, 12.0 * math.log2(hz / center)) for time, hz in hz_points]
    return points, len(hz_points), center


def final_change(points):
    if len(points) < 2:
        return "flat", 0.0
    end = points[-1][0]
    window = [point for point in points if point[0] >= end - FINAL_WINDOW]
    if len(window) < 2:
        window = points[-2:]
    count = len(window)
    mean_time = sum(time for time, _ in window) / count
    mean_st = sum(st for _, st in window) / count
    variance = sum((time - mean_time) ** 2 for time, _ in window)
    if variance <= 1e-12:
        return "flat", 0.0
    slope = sum((time - mean_time) * (st - mean_st) for time, st in window) / variance
    change = slope * FINAL_WINDOW
    if change > FINAL_SEMITONES:
        return "rise", change
    if change < -FINAL_SEMITONES:
        return "fall", change
    return "flat", change


def semitone_range(points):
    values = [st for _, st in points]
    return max(values) - min(values)


def downsample(points, limit):
    if len(points) <= limit:
        return [st for _, st in points]
    last = len(points) - 1
    picked = []
    for index in range(limit):
        source = int(round(index * last / (limit - 1)))
        picked.append(points[source][1])
    return picked


def dtw_align(left, right):
    rows = len(left)
    cols = len(right)
    if rows == 0 or cols == 0:
        return [], []
    inf = float("inf")
    cost = [[inf] * (cols + 1) for _ in range(rows + 1)]
    cost[0][0] = 0.0
    for i in range(1, rows + 1):
        sample = left[i - 1]
        previous = cost[i - 1]
        current = cost[i]
        for j in range(1, cols + 1):
            step = abs(sample - right[j - 1])
            best = previous[j - 1]
            if previous[j] < best:
                best = previous[j]
            if current[j - 1] < best:
                best = current[j - 1]
            current[j] = step + best
    i = rows
    j = cols
    aligned_left = []
    aligned_right = []
    while i > 0 and j > 0:
        aligned_left.append(left[i - 1])
        aligned_right.append(right[j - 1])
        if i == 1 and j == 1:
            break
        diagonal = cost[i - 1][j - 1]
        up = cost[i - 1][j]
        side = cost[i][j - 1]
        if diagonal <= up and diagonal <= side:
            i -= 1
            j -= 1
        elif up <= side:
            i -= 1
        else:
            j -= 1
    aligned_left.reverse()
    aligned_right.reverse()
    return aligned_left, aligned_right


def pearson(left, right):
    count = len(left)
    if count < 2 or count != len(right):
        return None
    mean_left = sum(left) / count
    mean_right = sum(right) / count
    var_left = sum((value - mean_left) ** 2 for value in left)
    var_right = sum((value - mean_right) ** 2 for value in right)
    if var_left <= 1e-12 or var_right <= 1e-12:
        return None
    covariance = sum((a - mean_left) * (b - mean_right) for a, b in zip(left, right))
    return covariance / math.sqrt(var_left * var_right)


def judge(teacher, student, teacher_voiced=None, student_voiced=None, teacher_median=None, student_median=None):
    teacher = list(teacher or [])
    student = list(student or [])
    teacher_count = len(teacher) if teacher_voiced is None else teacher_voiced
    student_count = len(student) if student_voiced is None else student_voiced
    measurement = {
        "teacherVoiced": teacher_count,
        "studentVoiced": student_count,
        "teacherMedianHz": teacher_median,
        "studentMedianHz": student_median,
        "studentRangeSemitones": None,
        "teacherFinalChange": None,
        "studentFinalChange": None,
        "correlation": None,
    }
    if teacher_count < MIN_VOICED or student_count < MIN_VOICED or len(teacher) < MIN_VOICED or len(student) < MIN_VOICED:
        return result("uncertain", None, None, None, measurement)

    teacher_dir, teacher_delta = final_change(teacher)
    student_dir, student_delta = final_change(student)
    student_range = semitone_range(student)
    aligned_teacher, aligned_student = dtw_align(downsample(teacher, MAX_ALIGN), downsample(student, MAX_ALIGN))
    correlation = pearson(aligned_teacher, aligned_student)
    agreement = None if correlation is None else round(max(0.0, min(1.0, correlation)), 4)
    measurement["studentRangeSemitones"] = round(student_range, 4)
    measurement["teacherFinalChange"] = round(teacher_delta, 4)
    measurement["studentFinalChange"] = round(student_delta, 4)
    measurement["correlation"] = None if correlation is None else round(correlation, 4)

    opposite = teacher_dir in ("rise", "fall") and student_dir in ("rise", "fall") and teacher_dir != student_dir
    # Flat wins over the ending. A low correlation does not create a mismatch on its own.
    # Opposite endings stay final_mismatch, including when correlation is below 0.4.
    if student_range < FLAT_RANGE:
        status = "flat"
    elif opposite:
        status = "final_mismatch"
    else:
        status = "match"
    return result(status, teacher_dir, student_dir, agreement, measurement)


def result(status, teacher_final, student_final, agreement, measurement):
    return {
        "ok": True,
        "status": status,
        "teacherFinal": teacher_final,
        "studentFinal": student_final,
        "contourAgreement": agreement,
        "measurement": measurement,
    }


def compare_paths(student_path, teacher_path):
    student, student_count, student_median = load_semitones(student_path)
    teacher, teacher_count, teacher_median = load_semitones(teacher_path)
    return judge(
        teacher,
        student,
        teacher_voiced=teacher_count,
        student_voiced=student_count,
        teacher_median=None if teacher_median is None else round(teacher_median, 2),
        student_median=None if student_median is None else round(student_median, 2),
    )


def line(start, end, seconds=0.8, step=0.01):
    count = int(round(seconds / step)) + 1
    return [(index * step, start + (end - start) * index / (count - 1)) for index in range(count)]


def assert_status(name, teacher, student, expected):
    actual = judge(teacher, student)["status"]
    if actual != expected:
        raise SystemExit(json.dumps({"ok": False, "error": name, "status": actual, "expected": expected}))


def self_test():
    rising = line(-2, 2)
    falling = line(2, -2)
    assert_status("same rise", rising, line(-1.5, 2.5), "match")
    assert_status("teacher rise student fall", rising, falling, "final_mismatch")
    assert_status("too few frames", rising, line(0, 1, seconds=0.05), "uncertain")

    # Student range stays under 2 semitones, so flat wins even when the ending rises.
    small_rise = [(index * 0.01, 0.0) for index in range(50)]
    small_rise.extend((0.50 + index * 0.01, 1.4 * index / 30) for index in range(31))
    assert_status("flat wins", falling, small_rise, "flat")

    # Same ending direction with a different body stays match. Correlation is only stored.
    dip = []
    for index in range(71):
        dip.append((index * 0.01, 2.0 - 4.0 * index / 70))
    dip.extend((0.70 + index * 0.01, -2.0 + 4.0 * index / 30) for index in range(31))
    dipped = judge(line(-2, 3, seconds=1.0), dip)
    if dipped["status"] != "match":
        raise SystemExit(json.dumps({"ok": False, "error": "correlation does not mark mismatch", "status": dipped["status"]}))

    copied = line(-1, 4, seconds=1.0)
    broken = [point for point in copied if point[0] < 0.7]
    for index in range(31):
        broken.append((0.70 + index * 0.01, broken[-1][1] - 3.5 * index / 30))
    opposite = judge(copied, broken)
    if opposite["status"] != "final_mismatch":
        raise SystemExit(json.dumps({"ok": False, "error": "opposite ending", "status": opposite["status"]}))

    audio = "skipped"
    if can_import():
        audio = audio_cases()
    json_out({"ok": True, "audio": audio})
    return 0


def audio_cases():
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        teacher = directory + "/teacher.wav"
        same = directory + "/same.wav"
        opposite = directory + "/opposite.wav"
        level = directory + "/level.wav"
        write_contour(teacher, ending_glide(180, 320))
        write_contour(same, ending_glide(200, 340))
        write_contour(opposite, ending_glide(320, 160))
        write_contour(level, lambda _time: 220.0)
        matched = compare_paths(same, teacher)
        mismatched = compare_paths(opposite, teacher)
        flat = compare_paths(level, teacher)
    if matched["status"] != "match":
        raise SystemExit(json.dumps({"ok": False, "error": "audio match", "result": matched}))
    if mismatched["status"] != "final_mismatch" or mismatched["teacherFinal"] != "rise" or mismatched["studentFinal"] != "fall":
        raise SystemExit(json.dumps({"ok": False, "error": "audio mismatch", "result": mismatched}))
    if flat["status"] != "flat":
        raise SystemExit(json.dumps({"ok": False, "error": "audio flat", "result": flat}))
    return "passed"


def ending_glide(steady, target):
    def f0(time):
        if time < 0.7:
            return steady
        span = min(max((time - 0.7) / 0.4, 0.0), 1.0)
        return steady + (target - steady) * span

    return f0


def write_contour(path, f0_at, duration=1.15, sample_rate=16000):
    count = int(duration * sample_rate)
    fade = int(sample_rate * 0.03)
    frames = bytearray()
    phase = 0.0
    for index in range(count):
        f0 = f0_at(index / sample_rate)
        phase += 2.0 * math.pi * f0 / sample_rate
        sample = 0.0
        harmonic = 1
        while harmonic * f0 < 2500 and harmonic <= 15:
            sample += math.sin(harmonic * phase) / harmonic
            harmonic += 1
        if index < fade:
            sample *= index / fade
        elif index > count - fade:
            sample *= (count - index) / fade
        sample = max(-1.0, min(1.0, sample * 0.45))
        frames += struct.pack("<h", int(sample * 32767))
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(frames)


def json_out(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=True))
    sys.stdout.write("\n")


def main(argv):
    if len(argv) == 2 and argv[1] == "--check":
        json_out({"available": can_import()})
        return 0
    if len(argv) == 2 and argv[1] == "--self-test":
        return self_test()
    if len(argv) != 3:
        json_out({"ok": False, "error": "usage"})
        return 0
    if not can_import():
        json_out({"ok": False, "error": "parselmouth_missing"})
        return 0
    try:
        json_out(compare_paths(argv[1], argv[2]))
    except Exception:
        json_out(result("uncertain", None, None, None, {"reason": "failed"}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
