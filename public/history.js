const {
  HOURS,
  mergeScheduleData,
  formatHour,
  formatHourRange,
  formatDateTime,
  getPeriodLabel,
  getActiveMergeSpan,
  countEntries,
  buildSummary,
  getCurrentRealm,
  realmApiUrl,
} = window.TimeRiver;

const currentRealm = getCurrentRealm();

const historyRefs = {
  timelineList: document.getElementById('timeline-list'),
  timelineEmpty: document.getElementById('timeline-empty'),
  timelineCount: document.getElementById('timeline-count'),
  detailEmpty: document.getElementById('detail-empty'),
  detailPanel: document.getElementById('archive-detail'),
  detailTitle: document.getElementById('archive-title'),
  detailCreatedAt: document.getElementById('archive-created-at'),
  detailCount: document.getElementById('archive-count'),
  detailD1Name: document.getElementById('archive-d1name'),
  detailD2Name: document.getElementById('archive-d2name'),
  detailD1Date: document.getElementById('archive-d1date'),
  detailD2Date: document.getElementById('archive-d2date'),
  detailSummary: document.getElementById('archive-summary-body'),
  detailGrid: document.getElementById('archive-days-grid'),
  mobileDayButtons: Array.from(document.querySelectorAll('[data-history-day-switch]')),
  d1Column: document.getElementById('archive-column-d1'),
  d2Column: document.getElementById('archive-column-d2'),
};

const archiveCache = new Map();
let archives = [];
let selectedArchiveId = null;
let activeMobileDay = 'd1';

async function fetchArchives() {
  const url = realmApiUrl('/api/archives', currentRealm);
  const response = await fetch(url);
  if (!response.ok) throw new Error('fetch archives failed');
  return response.json();
}

async function fetchArchiveDetail(id) {
  if (archiveCache.has(id)) return archiveCache.get(id);
  const url = realmApiUrl(`/api/archives/${id}`, currentRealm);
  const response = await fetch(url);
  if (!response.ok) throw new Error('fetch archive detail failed');
  const payload = await response.json();
  archiveCache.set(id, payload.archive);
  return payload.archive;
}

function createReadonlyTimeStamp(hour, span) {
  const label = document.createElement('div');
  label.className = 'time-stamp';
  label.style.gridRow = `${HOURS.indexOf(hour) + 1} / span ${span}`;

  const period = getPeriodLabel(hour);
  if (period) {
    const periodEl = document.createElement('span');
    periodEl.className = 'period-pill';
    periodEl.textContent = period;
    label.appendChild(periodEl);
  }

  const timeEl = document.createElement('span');
  timeEl.className = 'time-value';
  timeEl.textContent = span > 1 ? formatHourRange(hour, span) : formatHour(hour);
  label.appendChild(timeEl);
  return label;
}

function renderReadonlyDay(dayKey, root, dayData) {
  root.innerHTML = '';
  root.classList.add('readonly');
  root.style.setProperty('--rows', String(HOURS.length));

  let coveredUntil = -1;

  HOURS.forEach((hour, index) => {
    if (index <= coveredUntil) return;

    const value = dayData.slots[hour][dayKey].trim();
    const span = value ? getActiveMergeSpan(dayData, dayKey, index) : 1;
    if (span > 1) coveredUntil = index + span - 1;

    root.appendChild(createReadonlyTimeStamp(hour, span));

    const slot = document.createElement('div');
    const checkKey = `${dayKey}checked`;
    const isChecked = Boolean(dayData.slots[hour] && dayData.slots[hour][checkKey]);
    slot.className = `slot-card readonly-slot${value ? ' has-content' : ' is-empty'}${isChecked ? ' slot-checked' : ''}`;
    slot.style.gridRow = `${index + 1} / span ${span}`;
    slot.textContent = value;
    root.appendChild(slot);
  });
}

function setHistoryMobileDay(dayKey) {
  activeMobileDay = dayKey === 'd2' ? 'd2' : 'd1';
  historyRefs.detailGrid.dataset.activeDay = activeMobileDay;
  historyRefs.mobileDayButtons.forEach((button) => {
    const isActive = button.dataset.historyDaySwitch === activeMobileDay;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function setSelectedState() {
  document.querySelectorAll('.timeline-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.archiveId === selectedArchiveId);
  });
}

function renderTimeline() {
  historyRefs.timelineList.innerHTML = '';
  historyRefs.timelineCount.textContent = `${archives.length} 条`;

  if (!archives.length) {
    historyRefs.timelineEmpty.classList.remove('hidden');
    historyRefs.detailEmpty.classList.remove('hidden');
    historyRefs.detailPanel.classList.add('hidden');
    return;
  }

  historyRefs.timelineEmpty.classList.add('hidden');

  archives.forEach((archive) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'timeline-item';
    button.dataset.archiveId = archive.id;
    button.innerHTML = `
      <span class="timeline-item-title">${archive.title}</span>
      <span class="timeline-item-meta">${formatDateTime(archive.created_at)}</span>
    `;
    button.addEventListener('click', () => selectArchive(archive.id, true));
    historyRefs.timelineList.appendChild(button);
  });

  setSelectedState();
}

async function selectArchive(id, shouldScrollToDetail = false) {
  selectedArchiveId = id;
  setSelectedState();
  historyRefs.detailEmpty.classList.add('hidden');

  const archive = await fetchArchiveDetail(id);
  const dayData = mergeScheduleData(archive.data);
  const counts = countEntries(dayData);

  historyRefs.detailTitle.textContent = archive.title;
  historyRefs.detailCreatedAt.textContent = formatDateTime(archive.created_at);
  historyRefs.detailCount.textContent = `${counts.total} 项 / ${counts.totalHours} 小时`;
  historyRefs.detailD1Name.textContent = dayData.d1name || '第一天';
  historyRefs.detailD2Name.textContent = dayData.d2name || '第二天';
  historyRefs.detailD1Date.textContent = dayData.d1date || '未填写日期';
  historyRefs.detailD2Date.textContent = dayData.d2date || '未填写日期';
  historyRefs.detailSummary.textContent = buildSummary(dayData);
  renderReadonlyDay('d1', historyRefs.d1Column, dayData);
  renderReadonlyDay('d2', historyRefs.d2Column, dayData);
  setHistoryMobileDay(activeMobileDay);
  historyRefs.detailPanel.classList.remove('hidden');

  if (shouldScrollToDetail && window.matchMedia('(max-width: 720px)').matches) {
    historyRefs.detailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const url = new URL(window.location.href);
  url.searchParams.set('archive', id);
  window.history.replaceState({}, '', url);
}

(async function initHistory() {
  document.getElementById('back-button').addEventListener('click', () => {
    window.location.href = currentRealm ? `/${currentRealm}` : '/';
  });

  // 如果是疆域页面，调整标题
  if (currentRealm) {
    document.title = `${currentRealm} 历史 | 光阴长河`;
  }
  document.getElementById('history-print-button').addEventListener('click', () => {
    window.print();
  });
  historyRefs.mobileDayButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setHistoryMobileDay(button.dataset.historyDaySwitch);
    });
  });

  try {
    const payload = await fetchArchives();
    archives = payload.archives || [];
    renderTimeline();

    if (!archives.length) return;

    const url = new URL(window.location.href);
    const requestedId = url.searchParams.get('archive');
    const initialId = archives.some((archive) => archive.id === requestedId)
      ? requestedId
      : archives[0].id;

    await selectArchive(initialId);
  } catch (error) {
    historyRefs.timelineEmpty.classList.remove('hidden');
    historyRefs.timelineEmpty.innerHTML = '<p>暂时无法读取封存内容。</p>';
    console.error('History init failed:', error);
  }
}());
