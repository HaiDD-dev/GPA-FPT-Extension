/*
 * Runs on FAP's transcript page: reads the grade tables, saves them for the popup,
 * adds a "Tính GPA" checkbox column and a floating summary panel.
 */
(async function () {
  'use strict';

  const { FapGpa: Gpa, FapGpaStore: Store } = globalThis;
  const OUTSIDE_CURRICULUM = /outside the curriculum|ngoai chuong trinh/;

  const PANEL_HTML = `
    <header class="fgpa-panel__head">
      <span class="fgpa-panel__title">GPA</span>
      <b class="fgpa-panel__mini" data-field="mini"></b>
      <button type="button" class="fgpa-icon-btn" data-action="collapse" title="Thu gọn / mở rộng">–</button>
    </header>
    <div class="fgpa-panel__body">
      <div class="fgpa-stats">
        <div class="fgpa-stat"><b data-field="gpa10"></b><span>Hệ 10</span></div>
        <div class="fgpa-stat"><b data-field="gpa4"></b><span>Hệ 4 · tham khảo</span></div>
      </div>
      <p class="fgpa-meta" data-field="meta"></p>
      <p class="fgpa-warn" data-field="warn"></p>
      <div class="fgpa-actions">
        <button type="button" data-action="default" title="Chỉ tính các môn Passed, bỏ các môn không tính GPA">Mặc định</button>
        <button type="button" data-action="none">Bỏ chọn hết</button>
      </div>
      <p class="fgpa-hint">Tick cột <b>Tính GPA</b> để chọn môn. Nhập điểm dự kiến / thêm môn trong popup của extension.</p>
    </div>`;

  // A previous instance (e.g. before the extension was reloaded) may have left its UI behind.
  document.querySelectorAll('.fgpa-cell, #fgpa-panel').forEach((el) => el.remove());

  function tableSource(table, map, hasMain) {
    const card = table.closest('.card, section, fieldset');
    const heading = card && card.querySelector('.card-header, .card-title, h1, h2, h3, h4, h5, legend');
    if (heading && OUTSIDE_CURRICULUM.test(Gpa.normalizeText(heading.textContent))) return 'extra';
    // The curriculum table is the one with a Term column; later tables without it are extras.
    return map.term === undefined && hasMain ? 'extra' : 'main';
  }

  function scanTables() {
    const found = [];
    for (const table of document.querySelectorAll('table')) {
      const headRow = table.querySelector('thead tr') || table.querySelector('tr');
      if (!headRow) continue;
      const headers = [...headRow.cells].map((cell) => cell.textContent);
      const map = Gpa.mapColumns(headers);
      if (!map) continue;
      const rows = [...table.querySelectorAll('tbody tr')].filter((tr) => tr !== headRow);
      const source = tableSource(table, map, found.some((t) => t.source === 'main'));
      const cells = rows.map((tr) => [...tr.cells].map((td) => td.textContent));
      found.push({ headRow, rows, map, source, courses: Gpa.coursesFromTable(headers, cells, source) });
    }
    return found;
  }

  const tables = scanTables();
  if (!tables.length) return;

  const courses = tables.flatMap((t) => t.courses.map(({ row, ...course }) => course));
  const program = (/transcript\s+(.+?)\s+-\s+FAP/i.exec(document.title) || [])[1] || '';
  await Store.saveData({ courses, program, syncedAt: Date.now() });

  let state = (await Store.load()).state;

  // --- Checkbox column -------------------------------------------------------
  const rowUi = new Map();
  for (const { headRow, rows, map, courses: tableCourses } of tables) {
    const th = document.createElement('th');
    th.className = 'fgpa-cell fgpa-head text-center';
    th.textContent = 'Tính GPA';
    th.title = 'Chọn môn được tính vào GPA (extension GPA FPT)';
    headRow.insertBefore(th, headRow.firstElementChild);

    const cells = rows.map((tr) => {
      const td = document.createElement('td');
      td.className = 'fgpa-cell text-center';
      td.dataset.label = 'Tính GPA';
      tr.insertBefore(td, tr.firstElementChild);
      return td;
    });

    for (const course of tableCourses) {
      const tr = rows[course.row];
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'fgpa-check';
      input.dataset.id = course.id;
      input.setAttribute('aria-label', `Tính ${course.code} vào GPA`);
      cells[course.row].append(input);
      // +1 because the checkbox column now sits in front of the original cells.
      rowUi.set(course.id, { tr, input, gradeCell: tr.cells[map.grade + 1] });
    }
  }

  document.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.classList.contains('fgpa-check')) return;
    state.selection = { ...state.selection, [input.dataset.id]: input.checked };
    commit();
  });

  // --- Summary panel ---------------------------------------------------------
  const panel = document.createElement('aside');
  panel.id = 'fgpa-panel';
  panel.className = 'fgpa-panel';
  panel.setAttribute('aria-label', 'GPA đã chọn');
  panel.innerHTML = PANEL_HTML;
  document.body.append(panel);
  const field = (name) => panel.querySelector(`[data-field="${name}"]`);

  panel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'collapse') {
      state.settings = { ...state.settings, panelCollapsed: !state.settings.panelCollapsed };
    } else if (action === 'default') {
      state.selection = {};
    } else if (action === 'none') {
      const all = [...courses, ...state.manual];
      state.selection = Object.fromEntries(all.map((course) => [course.id, false]));
    }
    commit();
  });

  function render() {
    for (const course of courses) {
      const ui = rowUi.get(course.id);
      const selected = Gpa.isSelected(course, state);
      ui.input.checked = selected;
      ui.tr.classList.toggle('fgpa-off', !selected);

      let badge = ui.gradeCell && ui.gradeCell.querySelector('.fgpa-whatif');
      if (ui.gradeCell && Gpa.isOverridden(course, state)) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'fgpa-cell fgpa-whatif';
          ui.gradeCell.append(badge);
        }
        badge.textContent = `dự kiến ${state.overrides[course.id]}`;
      } else if (badge) {
        badge.remove();
      }
    }

    const summary = Gpa.summarize([...courses, ...state.manual], state);
    const gpa10 = Gpa.formatGpa(summary.gpa10);
    field('gpa10').textContent = gpa10;
    field('gpa4').textContent = Gpa.formatGpa(summary.gpa4);
    field('mini').textContent = gpa10;
    const manualNote = state.manual.length ? ` (gồm ${state.manual.length} môn tự thêm)` : '';
    field('meta').textContent = `${summary.count} môn · ${summary.credits} tín chỉ${manualNote}`;
    field('warn').textContent = summary.selectedWithoutGrade
      ? `${summary.selectedWithoutGrade} môn đã chọn nhưng chưa có điểm hoặc 0 tín chỉ — không được tính.`
      : '';
    const collapsed = Boolean(state.settings.panelCollapsed);
    panel.classList.toggle('is-collapsed', collapsed);
    panel.querySelector('[data-action="collapse"]').textContent = collapsed ? '+' : '–';
  }

  function commit() {
    render();
    Store.saveState(state);
  }

  Store.onChange(async () => {
    state = (await Store.load()).state;
    render();
  });

  render();
})();
