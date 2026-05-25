const {
  HOURS,
  PERIODS,
  mergeScheduleData,
  formatHour,
  formatDateTime,
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
  detailTitleCopy: document.getElementById('archive-title-copy'),
  detailCreatedAt: document.getElementById('archive-created-at'),
  detailCount: document.getElementById('archive-count'),
  detailD1Name: document.getElementById('archive-d1name'),
  detailD2Name: document.getElementById('archive-d2name'),
  detailD1Date: document.getElementById('archive-d1date'),
  detailD2Date: document.getElementById('archive-d2date'),
  detailSlots: document.getElementById('archive-slots'),
  detailSummary: document.getElementById('archive-summary-body'),
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

function renderArchiveSlots(data) {
  historyRefs.detailSlots.innerHTML = '';

  HOURS.forEach((hour, index) => {
    const period = PERIODS.find((item) => item.hour === hour);
    if (period && index > 0) {
      const separator = document.createElement('div');
      separator.className = 'period-sep';
      separator.innerHTML = `
        <div class="period-label">${period.label}</div>
        <div class="period-line"></div>
        <div class="period-line"></div>
      `;
      historyRefs.detailSlots.appendChild(separator);
    }

    const row = document.createElement('div');
    row.className = 'slot-row time-block';

    const label = document.createElement('div');
    label.className = 'time-label hour-mark';
    label.textContent = formatHour(hour);
    row.appendChild(label);

    ['d1', 'd2'].forEach((dayKey) => {
      const value = data.slots[hour][dayKey].trim();
      const cell = document.createElement('div');
      cell.className = `slot readonly-slot${value ? ' has-content' : ''}`;
      cell.textContent = value || '留白';
      row.appendChild(cell);
    });

    historyRefs.detailSlots.appendChild(row);
  });
}

function setSelectedState() {
  document.querySelectorAll('.timeline-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.archiveId === selectedArchiveId);
  });
}

function renderTimeline() {
  historyRefs.timelineList.innerHTML = '';
  historyRefs.timelineCount.textContent = `${archives.length} 段封存`;

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
      <span class="timeline-item-meta">${archive.d1_name || '第一天'} / ${archive.d2_name || '第二天'} · ${archive.entry_count} 项</span>
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
  const data = mergeScheduleData(archive.data);
  const counts = countEntries(data);

  historyRefs.detailTitle.textContent = archive.title;
  historyRefs.detailTitleCopy.textContent = archive.title;
  historyRefs.detailCreatedAt.textContent = formatDateTime(archive.created_at);
  historyRefs.detailCount.textContent = `${counts.total} 项`;
  historyRefs.detailD1Name.textContent = data.d1name || '第一天';
  historyRefs.detailD2Name.textContent = data.d2name || '第二天';
  historyRefs.detailD1Date.textContent = data.d1date || '未填写日期';
  historyRefs.detailD2Date.textContent = data.d2date || '未填写日期';
  historyRefs.detailSummary.textContent = buildSummary(data);
  renderArchiveSlots(data);
  historyRefs.detailPanel.classList.remove('hidden');

  const url = new URL(window.location.href);
  url.searchParams.set('archive', id);
  window.history.replaceState({}, '', url);
}

(async function initHistory() {
  document.getElementById('back-button').addEventListener('click', () => {
    window.location.href = '/';
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
    historyRefs.timelineEmpty.innerHTML = `
      <h2>历史长河暂时无法打开</h2>
      <p>请稍后刷新重试。</p>
    `;
    console.error('History init failed:', error);
  }
}());
