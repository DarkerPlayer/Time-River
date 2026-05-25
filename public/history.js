const {
  HOURS,
  mergeScheduleData,
  formatHour,
  formatDateTime,
  getPeriodLabel,
  countEntries,
  buildSummary,
} = window.TimeRiver;

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
  d1Column: document.getElementById('archive-column-d1'),
  d2Column: document.getElementById('archive-column-d2'),
};

const archiveCache = new Map();
let archives = [];
let selectedArchiveId = null;

async function fetchArchives() {
  const response = await fetch('/api/archives');
  if (!response.ok) throw new Error('fetch archives failed');
  return response.json();
}

async function fetchArchiveDetail(id) {
  if (archiveCache.has(id)) return archiveCache.get(id);
  const response = await fetch(`/api/archives/${id}`);
  if (!response.ok) throw new Error('fetch archive detail failed');
  const payload = await response.json();
  archiveCache.set(id, payload.archive);
  return payload.archive;
}

function createReadonlyTimeStamp(hour) {
  const label = document.createElement('div');
  label.className = 'time-stamp';
  label.style.gridRow = `${HOURS.indexOf(hour) + 1}`;

  const period = getPeriodLabel(hour);
  if (period) {
    const periodEl = document.createElement('span');
    periodEl.className = 'period-pill';
    periodEl.textContent = period;
    label.appendChild(periodEl);
  }

  const timeEl = document.createElement('span');
  timeEl.className = 'time-value';
  timeEl.textContent = formatHour(hour);
  label.appendChild(timeEl);
  return label;
}

function renderReadonlyDay(dayKey, root, dayData) {
  root.innerHTML = '';
  root.classList.add('readonly');
  root.style.setProperty('--rows', String(HOURS.length));

  HOURS.forEach((hour, index) => {
    root.appendChild(createReadonlyTimeStamp(hour));

    const slot = document.createElement('div');
    const value = dayData.slots[hour][dayKey].trim();
    slot.className = `slot-card readonly-slot${value ? ' has-content' : ' is-empty'}`;
    slot.style.gridRow = `${index + 1}`;
    slot.textContent = value;
    root.appendChild(slot);
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
    button.addEventListener('click', () => selectArchive(archive.id));
    historyRefs.timelineList.appendChild(button);
  });

  setSelectedState();
}

async function selectArchive(id) {
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
  historyRefs.detailPanel.classList.remove('hidden');

  const url = new URL(window.location.href);
  url.searchParams.set('archive', id);
  window.history.replaceState({}, '', url);
}

(async function initHistory() {
  document.getElementById('back-button').addEventListener('click', () => {
    window.location.href = '/';
  });
  document.getElementById('history-print-button').addEventListener('click', () => {
    window.print();
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
