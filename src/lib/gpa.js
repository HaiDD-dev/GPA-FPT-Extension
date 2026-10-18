/*
 * Core GPA logic shared by the content script, the popup and the tests.
 * No DOM access here: callers pass plain header/cell text.
 */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    // FPT "học phần điều kiện" do not count toward GPA (Quy chế đào tạo, Điều 3.3 & 20.3):
    // preparatory English (ENT, TRS), focused training / military education (GDQP, OTP),
    // physical education (VOV), OJT. TMI (traditional instrument) is not named in the regulation, but
    // FAP lists it in term 0 next to GDQP/VOV, i.e. in the focused-training stage.
    excludedPrefixes: ['ENT', 'TRS', 'GDQP', 'OTP', 'VOV', 'OJT', 'TMI'],
    includeFailed: false,
    panelCollapsed: false,
  });

  const COLUMN_PATTERNS = {
    no: /^(no|stt)$/,
    term: /^(term|ky)$/,
    semester: /^(semester|hoc ky)$/,
    code: /^(subject code|ma mon|ma mon hoc)$/,
    name: /^(subject name|ten mon|ten mon hoc)$/,
    credit: /^(credits?|tin chi|so tin chi)$/,
    grade: /^(grade|diem)$/,
    status: /^(status|trang thai)$/,
  };
  const REQUIRED_COLUMNS = ['code', 'credit', 'grade'];

  // FPT grading table (Quy chế đào tạo, Điều 19). The 10-point scale is official;
  // letters and 4-point values are for reference only.
  const SCALE_4 = [
    { min: 9.0, letter: 'A+', point: 4.0, rank: 'Xuất sắc' },
    { min: 8.5, letter: 'A', point: 3.75, rank: 'Giỏi' },
    { min: 8.0, letter: 'A-', point: 3.5, rank: 'Giỏi' },
    { min: 7.5, letter: 'B+', point: 3.25, rank: 'Khá' },
    { min: 7.0, letter: 'B', point: 3.0, rank: 'Khá' },
    { min: 6.5, letter: 'B-', point: 2.75, rank: 'Trung bình khá' },
    { min: 6.0, letter: 'C+', point: 2.5, rank: 'Trung bình khá' },
    { min: 5.5, letter: 'C', point: 2.25, rank: 'Trung bình' },
    { min: 5.0, letter: 'C-', point: 2.0, rank: 'Trung bình' },
    { min: 0, letter: 'F', point: 0, rank: 'Không đạt' },
  ];

  const SEASONS = ['spring', 'summer', 'fall'];

  function normalizeText(text) {
    return String(text ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function parseNumber(text) {
    const s = String(text ?? '').trim().replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  }

  /** Course grades are rounded to one decimal place (Quy chế đào tạo, Điều 20.2). */
  function parseGrade(text) {
    const n = parseNumber(text);
    return n !== null && n >= 0 && n <= 10 ? Math.round(n * 10 + 1e-9) / 10 : null;
  }

  /**
   * numerator / denominator rounded half-up to 2 decimals (Điều 20.3), using integer
   * division so cases like 8.145 do not round down through floating-point error.
   */
  function roundRatio2(numerator, denominator) {
    return Math.round((numerator * 100) / denominator) / 100;
  }

  /** Returns { code: 3, credit: 7, ... } or null when the table is not a transcript. */
  function mapColumns(headers) {
    const map = {};
    headers.forEach((header, index) => {
      const norm = normalizeText(header);
      for (const [key, pattern] of Object.entries(COLUMN_PATTERNS)) {
        if (map[key] === undefined && pattern.test(norm)) map[key] = index;
      }
    });
    return REQUIRED_COLUMNS.every((key) => map[key] !== undefined) ? map : null;
  }

  /**
   * Turns raw table text into course objects. Each course keeps `row`, the index of
   * the source row, so the caller can find the matching DOM row again.
   */
  function coursesFromTable(headers, rows, source) {
    const map = mapColumns(headers);
    if (!map) return [];
    const seen = new Map();
    const courses = [];
    rows.forEach((cells, row) => {
      const cell = (key) => (map[key] === undefined ? '' : String(cells[map[key]] ?? '').trim());
      const code = cell('code');
      if (!code || cells.length < headers.length) return;
      const count = (seen.get(code) || 0) + 1;
      seen.set(code, count);
      courses.push({
        id: `${source}:${code}${count > 1 ? `#${count}` : ''}`,
        source,
        row,
        code,
        name: cell('name'),
        semester: cell('semester').replace(/^-$/, ''),
        term: parseNumber(cell('term')),
        credit: parseNumber(cell('credit')) ?? 0,
        grade: parseGrade(cell('grade')),
        status: cell('status').replace(/^-$/, ''),
      });
    });
    return courses;
  }

  function isPassed(status) {
    return /^(passed|dat)$/.test(normalizeText(status));
  }

  function isFailed(status) {
    return /^(not passed|failed|khong dat|chua dat)$/.test(normalizeText(status));
  }

  function parsePrefixes(text) {
    return String(text ?? '')
      .split(/[\s,;]+/)
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean);
  }

  function isExcludedCode(code, prefixes) {
    const upper = String(code).toUpperCase();
    return prefixes.some((prefix) => upper.startsWith(prefix));
  }

  function emptyState() {
    return { selection: {}, overrides: {}, manual: [], settings: { ...DEFAULT_SETTINGS } };
  }

  function effectiveGrade(course, state) {
    const override = state.overrides[course.id];
    return typeof override === 'number' ? override : course.grade;
  }

  function isOverridden(course, state) {
    return typeof state.overrides[course.id] === 'number';
  }

  /** Whether a course counts when the user has not ticked/unticked it explicitly. */
  function isDefaultSelected(course, state) {
    if (course.source === 'manual') return true;
    if (course.source !== 'main') return false; // subjects outside the curriculum
    if (!(course.credit > 0)) return false;
    if (isExcludedCode(course.code, state.settings.excludedPrefixes)) return false;
    if (isOverridden(course, state)) return true;
    if (course.grade === null) return false;
    return isPassed(course.status) || (state.settings.includeFailed && isFailed(course.status));
  }

  function isSelected(course, state) {
    const explicit = state.selection[course.id];
    return typeof explicit === 'boolean' ? explicit : isDefaultSelected(course, state);
  }

  /** A selected course only affects GPA when it has a grade and a positive credit. */
  function isCounted(course, state) {
    return isSelected(course, state) && effectiveGrade(course, state) !== null && course.credit > 0;
  }

  function toScale4(grade) {
    return SCALE_4.find((step) => grade >= step.min);
  }

  /** GPA = Σ(grade × credit) / Σ credit over counted courses, rounded to 2 decimals. */
  function summarize(courses, state) {
    // Weighted sums are kept as integers (grade in tenths, 4-point in hundredths) for exact rounding.
    let credits = 0;
    let weighted10 = 0;
    let weighted4 = 0;
    let count = 0;
    let selectedWithoutGrade = 0;
    for (const course of courses) {
      if (!isSelected(course, state)) continue;
      if (!isCounted(course, state)) {
        selectedWithoutGrade += 1;
        continue;
      }
      const grade = effectiveGrade(course, state);
      credits += course.credit;
      weighted10 += Math.round(grade * 10) * course.credit;
      weighted4 += Math.round(toScale4(grade).point * 100) * course.credit;
      count += 1;
    }
    return {
      count,
      credits,
      selectedWithoutGrade,
      gpa10: credits ? roundRatio2(weighted10, credits * 10) : null,
      gpa4: credits ? roundRatio2(weighted4, credits * 100) : null,
    };
  }

  function semesterSortKey(semester) {
    const match = /^(spring|summer|fall)\s*(\d{4})$/i.exec(String(semester).trim());
    if (match) return Number(match[2]) * 3 + SEASONS.indexOf(match[1].toLowerCase());
    return semester ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER;
  }

  /** Groups courses by semester, oldest first; courses without a semester go last. */
  function groupBySemester(courses) {
    const groups = new Map();
    for (const course of courses) {
      const key = course.semester || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(course);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => semesterSortKey(a) - semesterSortKey(b))
      .map(([semester, items]) => ({ semester, courses: items }));
  }

  function formatGpa(value) {
    return value === null ? '—' : value.toFixed(2);
  }

  /** Rank of an (already rounded) 10-point GPA using the bands of Điều 19. */
  function rankOf(gpa10) {
    return gpa10 === null ? '' : toScale4(gpa10).rank;
  }

  const api = {
    DEFAULT_SETTINGS,
    normalizeText,
    parseNumber,
    parseGrade,
    parsePrefixes,
    mapColumns,
    coursesFromTable,
    isPassed,
    isFailed,
    isExcludedCode,
    emptyState,
    effectiveGrade,
    isOverridden,
    isDefaultSelected,
    isSelected,
    isCounted,
    toScale4,
    summarize,
    groupBySemester,
    formatGpa,
    rankOf,
  };

  root.FapGpa = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
