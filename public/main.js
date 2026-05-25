const {
  HOURS,
  emptyData,
  mergeScheduleData,
  formatHour,
  formatHourRange,
  countEntries,
  buildSummary,
  defaultArchiveTitle,
} = window.TimeRiver;

const DAY_KEYS = ['d1', 'd2'];
const MERGE_STORAGE_KEY = 'time-river-display-merges';

let data = emptyData();
let saveTimer = null;
let sealing = false;
let mergeState = loadMergeState();

const refs = {
  overlay: document.getElementById('loading-overlay'),
  syncStatus: document.getElementById('sync-status'),
  syncText: document.getElementById('sync-text'),
  lastSync: document.getElementById('last-sync'),
  summaryPanel: document.getElementById('summary-panel'),
  summaryBody: document.getElementById('summary-body'),
  copyFeedback: document.getElementById('copy-feedback'),
  toast: document.getElementById('toast'),
  sealModal: document.getElementById('seal-modal'),
  sealTitleInput: document.getElementById('seal-title-input'),
  sealError: document.getElementById('seal-error'),
  sealSubmitButton: document.getElementById('seal-submit-button'),
  d1Column: document.getElementById('day-column-d1'),
  d2Column: document.getElementById('day-column-d2'),
};

function loadMergeState() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MERGE_STORAGE_KEY) || '{}');
    return {
      d1: parsed.d1 && typeof parsed.d1 === 'object' ? parsed.d1 : {},
      d2: parsed.d2 && typeof parsed.d2 === 'object' ? parsed.d2 : {},
    };
  } catch {
    return { d1: {}, d2: {} };
  }
}

function saveMergeState() {
  window.localStorage.setItem(MERGE_STORAGE_KEY, JSON.stringify(mergeState));
}

function setSyncStatus(state, detail) {
  refs.syncStatus.className = `sync-status ${state}`;

  if (state === 'syncing') {
    refs.syncText.textContent = '同步中';
    return;
  }

  if (state === 'synced') {
    refs.syncText.textContent = '已同步';
    const now = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    refs.lastSync.textContent = `最后同步 ${now}`;
    return;
  }

  if (state === 'error') {
    refs.syncText.textContent = detail || '同步失败';
    return;
  }

  refs.syncText.textContent = '连接中';
}

function showToast(message, tone = 'success') {
  refs.toast.textContent = message;
  refs.toast.dataset.tone = tone;
  refs.toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    refs.toast.classList.remove('visible');
  }, 2200);
}

async function fetchSchedule() {
  const response = await fetch('/api/schedule');
  if (!response.ok) throw new Error('fetch failed');
  return response.json();
}

async function pushSchedule(payload) {
  const response = await fetch('/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('push failed');
  return response.json();
}

async function createArchive(title) {
  const response = await fetch('/api/archives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, data }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'archive failed');
  return payload;
}

function applyDataToDOM() {
  document.getElementById('d1name').value = data.d1name;
  document.getElementById('d2name').value = data.d2name;
  document.getElementById('d1date').value = data.d1date;
  document.getElementById('d2date').value = data.d2date;
}

function getMaxMergeSpan(dayKey, startIndex) {
  const startHour = HOURS[startIndex];
  const startValue = data.slots[startHour][dayKey].trim();
  if (!startValue) return 1;

  let maxSpan = 1;
  for (let index = startIndex + 1; index < HOURS.length; index += 1) {
    const nextValue = data.slots[HOURS[index]][dayKey].trim();
    if (nextValue) break;
    maxSpan += 1;
  }

  return Math.min(maxSpan, 6);
}

function getActiveSpan(dayKey, startIndex) {
  const hour = HOURS[startIndex];
  const rawSpan = Number(mergeState[dayKey][hour] || 1);
  const maxSpan = getMaxMergeSpan(dayKey, startIndex);
  if (!Number.isFinite(rawSpan) || rawSpan < 1) return 1;
  return Math.min(rawSpan, maxSpan);
}

function cleanupMergeState() {
  DAY_KEYS.forEach((dayKey) => {
    HOURS.forEach((hour, index) => {
      const value = data.slots[hour][dayKey].trim();
      if (!value) {
        delete mergeState[dayKey][hour];
        return;
      }

      const span = getActiveSpan(dayKey, index);
      if (span <= 1) delete mergeState[dayKey][hour];
      else mergeState[dayKey][hour] = span;
    });
  });
  saveMergeState();
}

function renderDayColumn(dayKey, root) {
  root.innerHTML = '';
  root.classList.remove('readonly');
  root.style.setProperty('--rows', String(HOURS.length));

  let coveredUntil = -1;

  HOURS.forEach((hour, index) => {
    if (index <= coveredUntil) return;

    const value = data.slots[hour][dayKey].trim();
    const span = value ? getActiveSpan(dayKey, index) : 1;
    if (span > 1) coveredUntil = index + span - 1;

    const label = document.createElement('div');
    label.className = 'time-stamp';
    label.style.gridRow = `${index + 1} / span ${span}`;
    label.textContent = value ? formatHourRange(hour, span) : formatHour(hour);
    root.appendChild(label);

    const slot = document.createElement('div');
    slot.className = `slot-card${value ? ' has-content' : ''}`;
    slot.style.gridRow = `${index + 1} / span ${span}`;

    const textarea = document.createElement('textarea');
    textarea.className = 'slot-input';
    textarea.rows = 1;
    textarea.placeholder = '添加事项';
    textarea.value = data.slots[hour][dayKey];
    textarea.addEventListener('input', (event) => {
      data.slots[hour][dayKey] = event.target.value;
      slot.classList.toggle('has-content', Boolean(event.target.value.trim()));
      scheduleSave();
    });
    textarea.addEventListener('blur', () => {
      cleanupMergeState();
      renderColumns();
    });
    slot.appendChild(textarea);

    if (value) {
      const maxSpan = getMaxMergeSpan(dayKey, index);
      if (maxSpan > 1 || span > 1) {
        const controls = document.createElement('div');
        controls.className = 'slot-controls';

        const select = document.createElement('select');
        select.className = 'merge-select';

        for (let optionValue = 1; optionValue <= maxSpan; optionValue += 1) {
          const option = document.createElement('option');
          option.value = String(optionValue);
          option.textContent = optionValue === 1 ? '1小时' : `${optionValue}小时`;
          if (optionValue === span) option.selected = true;
          select.appendChild(option);
        }

        select.addEventListener('change', (event) => {
          const nextSpan = Number(event.target.value);
          if (nextSpan <= 1) delete mergeState[dayKey][hour];
          else mergeState[dayKey][hour] = nextSpan;
          saveMergeState();
          renderColumns();
        });

        controls.appendChild(select);
        slot.appendChild(controls);
      }
    }

    root.appendChild(slot);
  });
}

function renderColumns() {
  cleanupMergeState();
  renderDayColumn('d1', refs.d1Column);
  renderDayColumn('d2', refs.d2Column);
}

function openSealModal() {
  refs.sealTitleInput.value = defaultArchiveTitle(data);
  refs.sealError.textContent = '';
  refs.sealError.classList.add('hidden');
  refs.sealModal.classList.remove('hidden');
  refs.sealTitleInput.focus();
  refs.sealTitleInput.select();
}

function closeSealModal() {
  refs.sealModal.classList.add('hidden');
}

function scheduleSave() {
  setSyncStatus('syncing');
  window.clearTimeout(saveTimer);

  saveTimer = window.setTimeout(async () => {
    try {
      await pushSchedule(data);
      setSyncStatus('synced');
    } catch (error) {
      setSyncStatus('error');
      console.error('Save error:', error);
    }
  }, 500);
}

function renderSummary() {
  refs.summaryBody.textContent = buildSummary(data);
  refs.summaryPanel.classList.add('visible');
  refs.summaryPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function clearAll() {
  if (!window.confirm('确定清空当前日程吗？')) return;

  data = emptyData();
  mergeState = { d1: {}, d2: {} };
  saveMergeState();
  applyDataToDOM();
  renderColumns();
  refs.summaryPanel.classList.remove('visible');

  try {
    await pushSchedule(data);
    setSyncStatus('synced');
    showToast('已清空');
  } catch (error) {
    setSyncStatus('error');
    console.error('Clear error:', error);
  }
}

async function submitSeal() {
  if (sealing) return;

  const title = refs.sealTitleInput.value.trim();
  if (!title) {
    refs.sealError.textContent = '请填写历史事件名称';
    refs.sealError.classList.remove('hidden');
    refs.sealTitleInput.focus();
    return;
  }

  refs.sealError.classList.add('hidden');
  sealing = true;
  refs.sealSubmitButton.disabled = true;
  refs.sealSubmitButton.textContent = '封印中';

  try {
    await createArchive(title);
    closeSealModal();
    showToast(`已封存：${title}`);
  } catch (error) {
    refs.sealError.textContent = error.message || '封印失败';
    refs.sealError.classList.remove('hidden');
  } finally {
    sealing = false;
    refs.sealSubmitButton.disabled = false;
    refs.sealSubmitButton.textContent = '封入长河';
  }
}

function bindStaticEvents() {
  ['d1name', 'd2name', 'd1date', 'd2date'].forEach((id) => {
    document.getElementById(id).addEventListener('input', (event) => {
      data[id] = event.target.value;
      scheduleSave();
    });
  });

  document.getElementById('history-button').addEventListener('click', () => {
    window.location.href = '/history.html';
  });
  document.getElementById('seal-button').addEventListener('click', openSealModal);
  document.getElementById('summary-button').addEventListener('click', renderSummary);
  document.getElementById('print-button').addEventListener('click', () => window.print());
  document.getElementById('clear-button').addEventListener('click', clearAll);
  document.getElementById('copy-button').addEventListener('click', async () => {
    await navigator.clipboard.writeText(refs.summaryBody.textContent);
    refs.copyFeedback.classList.add('visible');
    window.setTimeout(() => refs.copyFeedback.classList.remove('visible'), 1600);
  });
  document.getElementById('seal-close-button').addEventListener('click', closeSealModal);
  document.getElementById('seal-cancel-button').addEventListener('click', closeSealModal);
  refs.sealModal.addEventListener('click', (event) => {
    if (event.target === refs.sealModal) closeSealModal();
  });
  refs.sealTitleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submitSeal();
    if (event.key === 'Escape') closeSealModal();
  });
  refs.sealSubmitButton.addEventListener('click', submitSeal);
}

(async function init() {
  bindStaticEvents();

  try {
    const result = await fetchSchedule();
    if (result.data) data = mergeScheduleData(result.data);
    applyDataToDOM();
    renderColumns();
    const counts = countEntries(data);
    refs.lastSync.textContent = counts.total ? `共 ${counts.total} 项安排` : '今天还没有安排';
    setSyncStatus('synced');
  } catch (error) {
    console.error('Init failed:', error);
    applyDataToDOM();
    renderColumns();
    setSyncStatus('error', '无法连接');
  } finally {
    refs.overlay.classList.add('hidden');
    window.setTimeout(() => refs.overlay.remove(), 320);
  }
}());
