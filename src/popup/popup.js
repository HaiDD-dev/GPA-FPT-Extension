(async function () {
  'use strict';

  const { FapGpa: Gpa, FapGpaStore: Store } = globalThis;
  const ext = globalThis.browser && globalThis.browser.tabs ? globalThis.browser : globalThis.chrome;
  const TRANSCRIPT_URL = 'https://fap.fpt.edu.vn/Report/Transcript';

  const $ = (selector) => document.querySelector(selector);
  const list = $('#list');
  const search = $('#search');

  let data = null;
  let state = Gpa.emptyState();

  function allCourses() {
    return [...(data ? data.courses : []), ...state.manual];
  }

  function findCourse(id) {
    return allCourses().find((course) => course.id === id);
  }

  function commit() {
    render();
    Store.saveState(state);
  }

  // --- Rendering -------------------------------------------------------------
  function statusPill(course) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    if (course.source === 'manual') {
      pill.textContent = 'Tự thêm';
      pill.classList.add('pill--manual');
    } else if (Gpa.isPassed(course.status)) {
      pill.textContent = 'Passed';
      pill.classList.add('pill--passed');
    } else if (Gpa.isFailed(course.status)) {
      pill.textContent = 'Not passed';
      pill.classList.add('pill--failed');
    } else if (course.status) {
      pill.textContent = course.status;
      pill.classList.add('pill--progress');
    } else {
      pill.textContent = '—';
    }
    pill.title = course.status || '';
    return pill;
  }

  function courseItem(course) {
    const selected = Gpa.isSelected(course, state);
    const li = document.createElement('li');
    li.className = 'course';
    li.classList.toggle('is-off', !selected);
    li.dataset.search = Gpa.normalizeText(`${course.code} ${course.name}`);

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'course-check';
    check.checked = selected;
    check.dataset.id = course.id;
    check.setAttribute('aria-label', `Tính ${course.code} vào GPA`);

    const main = document.createElement('div');
    main.className = 'course__main';
    const code = document.createElement('span');
    code.className = 'course__code';
    code.textContent = course.code;
    const name = document.createElement('span');
    name.className = 'course__name';
    name.textContent = course.name || '';
    name.title = course.name || '';
    main.append(code, name);
    if (course.source === 'extra') main.append(tag('Ngoài CTĐT'));
    if (course.source !== 'manual' && Gpa.isExcludedCode(course.code, state.settings.excludedPrefixes)) {
      main.append(tag('Không tính GPA'));
    }

    const credit = document.createElement('span');
    credit.className = 'course__credit';
    credit.textContent = `${course.credit} TC`;

    const grade = document.createElement('input');
    grade.type = 'number';
    grade.className = 'grade';
    grade.min = '0';
    grade.max = '10';
    grade.step = '0.1';
    grade.placeholder = '—';
    grade.dataset.id = course.id;
    const effective = Gpa.effectiveGrade(course, state);
    grade.value = effective === null ? '' : String(effective);
    if (Gpa.isOverridden(course, state)) {
      grade.classList.add('is-override');
      grade.title = `Điểm dự kiến. Điểm trên FAP: ${course.grade === null ? 'chưa có' : course.grade}. Xoá ô để trả về.`;
    } else {
      grade.title = 'Nhập điểm dự kiến để tính thử';
    }

    const end = document.createElement('div');
    end.className = 'course__end';
    end.append(statusPill(course));
    if (course.source === 'manual') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn';
      remove.dataset.remove = course.id;
      remove.title = 'Xoá môn này';
      remove.textContent = '×';
      end.append(remove);
    }

    li.append(check, main, credit, grade, end);
    return li;
  }

  function tag(text) {
    const el = document.createElement('span');
    el.className = 'tag';
    el.textContent = text;
    return el;
  }

  function semesterSection(semester, courses, label) {
    const section = document.createElement('section');
    section.className = 'sem';

    const selectedCount = courses.filter((course) => Gpa.isSelected(course, state)).length;
    const summary = Gpa.summarize(courses, state);

    const head = document.createElement('header');
    head.className = 'sem__head';
    const toggle = document.createElement('label');
    toggle.className = 'sem__toggle';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'sem-check';
    check.dataset.semester = semester;
    check.checked = selectedCount === courses.length;
    check.indeterminate = selectedCount > 0 && selectedCount < courses.length;
    const title = document.createElement('span');
    title.textContent = label;
    toggle.append(check, title);

    const stats = document.createElement('span');
    stats.className = 'sem__stats';
    stats.textContent = `${summary.count}/${courses.length} môn · ${summary.credits} TC · `;
    const gpa = document.createElement('b');
    gpa.textContent = Gpa.formatGpa(summary.gpa10);
    stats.append(gpa);
    head.append(toggle, stats);

    const ul = document.createElement('ul');
    courses.forEach((course) => ul.append(courseItem(course)));
    section.append(head, ul);
    return section;
  }

  function renderSummary() {
    const summary = Gpa.summarize(allCourses(), state);
    $('#gpa10').textContent = Gpa.formatGpa(summary.gpa10);
    $('#rank').textContent = summary.gpa10 === null ? '' : ` · ${Gpa.rankOf(summary.gpa10)}`;
    $('#gpa4').textContent = Gpa.formatGpa(summary.gpa4);
    $('#credits').textContent = summary.credits;
    $('#count').textContent = summary.count;
    const warn = $('#warn');
    warn.hidden = !summary.selectedWithoutGrade;
    warn.textContent = `${summary.selectedWithoutGrade} môn đã chọn nhưng chưa có điểm hoặc 0 tín chỉ — không được tính. Nhập điểm dự kiến để tính thử.`;

    if (data) {
      const when = new Date(data.syncedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
      $('#sync').textContent = `${data.program ? `${data.program} · ` : ''}đồng bộ lúc ${when}`;
    } else {
      $('#sync').textContent = 'Chưa đồng bộ bảng điểm';
    }
  }

  function renderList() {
    const fragment = document.createDocumentFragment();
    const fapCourses = data ? data.courses : [];
    for (const { semester, courses } of Gpa.groupBySemester(fapCourses.filter((c) => c.source === 'main'))) {
      fragment.append(semesterSection(semester, courses, semester || 'Chưa học'));
    }
    const extra = fapCourses.filter((course) => course.source === 'extra');
    if (extra.length) fragment.append(semesterSection('extra', extra, 'Ngoài chương trình đào tạo'));
    if (state.manual.length) fragment.append(semesterSection('manual', state.manual, 'Môn tự thêm'));
    list.replaceChildren(fragment);
    $('#empty').hidden = allCourses().length > 0;
    applySearch();
  }

  function applySearch() {
    const query = Gpa.normalizeText(search.value);
    for (const section of list.querySelectorAll('.sem')) {
      let visible = 0;
      for (const item of section.querySelectorAll('.course')) {
        const match = !query || item.dataset.search.includes(query);
        item.hidden = !match;
        if (match) visible += 1;
      }
      section.hidden = visible === 0;
    }
  }

  function renderSettings() {
    const excluded = $('#excluded');
    if (document.activeElement !== excluded) excluded.value = state.settings.excludedPrefixes.join(', ');
    $('#include-failed').checked = state.settings.includeFailed;
  }

  function render() {
    renderSummary();
    renderList();
    renderSettings();
  }

  // --- Events ----------------------------------------------------------------
  function coursesOfSection(semester) {
    if (semester === 'manual') return state.manual;
    const fapCourses = data ? data.courses : [];
    if (semester === 'extra') return fapCourses.filter((course) => course.source === 'extra');
    return fapCourses.filter((course) => course.source === 'main' && (course.semester || '') === semester);
  }

  function setGrade(course, raw) {
    const value = raw.trim() === '' ? null : Gpa.parseGrade(raw);
    if (raw.trim() !== '' && value === null) return; // invalid input: render() restores the old value
    if (course.source === 'manual') {
      state.manual = state.manual.map((c) => (c.id === course.id ? { ...c, grade: value } : c));
      return;
    }
    const overrides = { ...state.overrides };
    if (value === null || value === course.grade) delete overrides[course.id];
    else overrides[course.id] = value;
    state.overrides = overrides;
  }

  list.addEventListener('change', (event) => {
    const target = event.target;
    if (target.classList.contains('course-check')) {
      state.selection = { ...state.selection, [target.dataset.id]: target.checked };
    } else if (target.classList.contains('sem-check')) {
      const courses = coursesOfSection(target.dataset.semester);
      const allSelected = courses.every((course) => Gpa.isSelected(course, state));
      const selection = { ...state.selection };
      courses.forEach((course) => (selection[course.id] = !allSelected));
      state.selection = selection;
    } else if (target.classList.contains('grade')) {
      const course = findCourse(target.dataset.id);
      if (course) setGrade(course, target.value);
    } else {
      return;
    }
    commit();
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    const id = button.dataset.remove;
    state.manual = state.manual.filter((course) => course.id !== id);
    const { [id]: _removed, ...selection } = state.selection;
    state.selection = selection;
    commit();
  });

  document.querySelector('.toolbar__actions').addEventListener('click', (event) => {
    const action = event.target.closest('[data-bulk]')?.dataset.bulk;
    if (!action) return;
    if (action === 'default') {
      state.selection = {};
    } else {
      const graded = action === 'graded';
      state.selection = Object.fromEntries(
        allCourses().map((course) => [
          course.id,
          graded && Gpa.effectiveGrade(course, state) !== null && course.credit > 0,
        ]),
      );
    }
    commit();
  });

  search.addEventListener('input', applySearch);

  $('#open-fap').addEventListener('click', () => ext.tabs.create({ url: TRANSCRIPT_URL }));

  $('#add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const credit = Gpa.parseNumber(values.credit);
    if (!values.code.trim() || !(credit > 0)) return;
    state.manual = [
      ...state.manual,
      {
        id: `manual:${Date.now().toString(36)}`,
        source: 'manual',
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        semester: '',
        term: null,
        credit,
        grade: Gpa.parseGrade(values.grade),
        status: '',
      },
    ];
    form.reset();
    form.elements.code.focus();
    commit();
  });

  $('#excluded').addEventListener('change', (event) => {
    state.settings = { ...state.settings, excludedPrefixes: Gpa.parsePrefixes(event.target.value) };
    commit();
  });

  $('#include-failed').addEventListener('change', (event) => {
    state.settings = { ...state.settings, includeFailed: event.target.checked };
    commit();
  });

  const clearButton = $('#clear');
  clearButton.addEventListener('click', async () => {
    if (!clearButton.classList.contains('is-confirming')) {
      clearButton.classList.add('is-confirming');
      clearButton.textContent = 'Bấm lần nữa để xác nhận xoá';
      setTimeout(() => {
        clearButton.classList.remove('is-confirming');
        clearButton.textContent = 'Xoá toàn bộ dữ liệu đã lưu';
      }, 4000);
      return;
    }
    await Store.clearAll();
  });

  async function reload() {
    ({ data, state } = await Store.load());
    render();
  }

  Store.onChange(reload);
  await reload();
})();
