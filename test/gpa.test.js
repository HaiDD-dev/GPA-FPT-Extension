const test = require('node:test');
const assert = require('node:assert/strict');
const Gpa = require('../src/lib/gpa.js');

// Same columns as FAP's "Report/Transcript" curriculum table (sample data).
const MAIN_HEADERS = ['No.', 'Term', 'Semester', 'Subject code', 'Prerequisites', 'Replaced subject', 'Subject name', 'Credits', 'Grade', 'Status'];
const MAIN_ROWS = [
  ['1', '-3', '-', 'ENT104', '-', '-', 'Elementary English', '0', '-', '-'],
  ['2', '0', 'Fall2023', 'GDQP', '-', '-', 'Military Training', '0', '7.5', 'Passed'],
  ['3', '1', 'Fall2023', 'VOV114', '-', '-', 'Vovinam 1', '2', '9.0', 'Passed'],
  ['4', '1', 'Fall2023', 'PRF192', '-', '-', 'Programming Fundamentals', '3', '8.0', 'Passed'],
  ['5', '1', 'Fall2023', 'MAE101', '-', '-', 'Mathematics for Engineering', '3', '6.0', 'Passed'],
  ['6', '2', 'Spring2024', 'PRO192', 'PRF192', '-', 'Object-Oriented Programming', '3', '4.0', 'Not passed'],
  ['7', '2', 'Spring2024', 'CSD201', '-', 'DSA103', 'Data Structures and Algorithm', '3', '10.0', 'Passed'],
  ['8', '6', 'Fall2025', 'OJT202', '-', '-', 'On the job training', '10', '-', 'In progress'],
  ['9', '9', '-', 'SE_GRA_ELE', '-', '-', 'Graduation Elective', '10', '-', '-'],
];
const EXTRA_HEADERS = ['No.', 'Semester', 'Subject code', 'Subject name', 'Credits', 'Grade', 'Status'];
const EXTRA_ROWS = [['1', 'Fall2025', 'ACM101', 'Activity', '3', '8.0', 'Passed']];

function load() {
  return [
    ...Gpa.coursesFromTable(MAIN_HEADERS, MAIN_ROWS, 'main'),
    ...Gpa.coursesFromTable(EXTRA_HEADERS, EXTRA_ROWS, 'extra'),
  ];
}

test('maps FAP columns by header text, in English or Vietnamese', () => {
  assert.deepEqual(Gpa.mapColumns(MAIN_HEADERS), {
    no: 0, term: 1, semester: 2, code: 3, name: 6, credit: 7, grade: 8, status: 9,
  });
  assert.equal(Gpa.mapColumns(['STT', 'Mã môn', 'Tên môn', 'Tín chỉ', 'Điểm', 'Trạng thái']).credit, 3);
  assert.equal(Gpa.mapColumns(['Date', 'Slot', 'Room']), null);
});

test('parses rows into courses', () => {
  const courses = load();
  assert.equal(courses.length, 10);
  const prf = courses.find((c) => c.code === 'PRF192');
  assert.deepEqual(prf, {
    id: 'main:PRF192', source: 'main', row: 3, code: 'PRF192', name: 'Programming Fundamentals',
    semester: 'Fall2023', term: 1, credit: 3, grade: 8, status: 'Passed',
  });
  const ent = courses.find((c) => c.code === 'ENT104');
  assert.equal(ent.grade, null);
  assert.equal(ent.semester, '');
  assert.equal(ent.status, '');
  assert.equal(courses.find((c) => c.code === 'ACM101').id, 'extra:ACM101');
});

test('skips short rows and de-duplicates ids', () => {
  const rows = [['No data'], MAIN_ROWS[3], MAIN_ROWS[3]];
  const courses = Gpa.coursesFromTable(MAIN_HEADERS, rows, 'main');
  assert.deepEqual(courses.map((c) => [c.id, c.row]), [['main:PRF192', 1], ['main:PRF192#2', 2]]);
});

test('default selection counts only passed curriculum subjects outside the excluded list', () => {
  const state = Gpa.emptyState();
  const selected = load().filter((c) => Gpa.isSelected(c, state)).map((c) => c.code);
  assert.deepEqual(selected, ['PRF192', 'MAE101', 'CSD201']);

  const summary = Gpa.summarize(load(), state);
  assert.equal(summary.count, 3);
  assert.equal(summary.credits, 9);
  assert.equal(summary.gpa10.toFixed(4), ((8 + 6 + 10) / 3).toFixed(4));
  assert.equal(summary.gpa4.toFixed(4), ((3.5 + 2 + 4) / 3).toFixed(4));
});

test('explicit selection overrides the default rule', () => {
  const state = Gpa.emptyState();
  state.selection = { 'main:VOV114': true, 'main:MAE101': false, 'main:SE_GRA_ELE': true };
  const summary = Gpa.summarize(load(), state);
  assert.equal(summary.count, 3); // PRF192, CSD201, VOV114
  assert.equal(summary.credits, 8);
  assert.equal(summary.gpa10, (8 * 3 + 10 * 3 + 9 * 2) / 8);
  assert.equal(summary.selectedWithoutGrade, 1); // SE_GRA_ELE has no grade yet
});

test('what-if grades are selected by default and replace the FAP grade', () => {
  const state = Gpa.emptyState();
  state.overrides = { 'main:OJT202': 9, 'main:MAE101': 7 };
  const summary = Gpa.summarize(load(), state);
  assert.equal(summary.credits, 19);
  assert.equal(summary.gpa10, (8 * 3 + 7 * 3 + 10 * 3 + 9 * 10) / 19);
});

test('includeFailed setting and excluded prefixes', () => {
  const state = Gpa.emptyState();
  state.settings = { ...state.settings, includeFailed: true, excludedPrefixes: Gpa.parsePrefixes('ent, gdqp; tmi') };
  const selected = load().filter((c) => Gpa.isSelected(c, state)).map((c) => c.code);
  assert.deepEqual(selected, ['VOV114', 'PRF192', 'MAE101', 'PRO192', 'CSD201']);
});

test('manual courses count by default', () => {
  const state = Gpa.emptyState();
  state.manual = [{ id: 'manual:a', source: 'manual', code: 'X', name: '', semester: '', term: null, credit: 4, grade: 5, status: '' }];
  const summary = Gpa.summarize([...load(), ...state.manual], state);
  assert.equal(summary.credits, 13);
  assert.equal(summary.gpa10, (8 * 3 + 6 * 3 + 10 * 3 + 5 * 4) / 13);
});

test('4-point conversion boundaries', () => {
  assert.deepEqual([10, 8.5, 8.4, 8, 7, 6.9, 5.5, 5, 4.9, 4, 3.9, 0].map((g) => Gpa.toScale4(g).letter),
    ['A', 'A', 'B+', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'D', 'F', 'F']);
});

test('groups semesters chronologically with unscheduled subjects last', () => {
  const order = Gpa.groupBySemester(load().filter((c) => c.source === 'main')).map((g) => g.semester);
  assert.deepEqual(order, ['Fall2023', 'Spring2024', 'Fall2025', '']);
});

test('grade parsing', () => {
  assert.equal(Gpa.parseGrade('8,5'), 8.5);
  assert.equal(Gpa.parseGrade(' 10.0 '), 10);
  assert.equal(Gpa.parseGrade('-'), null);
  assert.equal(Gpa.parseGrade('11'), null);
  assert.equal(Gpa.formatGpa(null), '—');
  assert.equal(Gpa.formatGpa(8.125), '8.13');
});
