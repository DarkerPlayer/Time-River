const {
  HOURS,
  PERIODS,
  emptyData,
  mergeScheduleData,
  formatHour,
  countEntries,
  buildSummary,
  defaultArchiveTitle,
} = window.TimeRiver;

let data = emptyData();
let saveTimer = null;
let sealing = false;

const refs = {
  overlay: document.getElementById('loading-overlay'),
  syncStatus: document.getElementById('sync-status'),
  syncText: document.getElementById('sync-text'),
  lastSync: document.getElementById('last-sync'),
  slots: document.getElementById('slots'),
  summaryPanel: document.getElementById('summary-panel'),
  summaryBody: document.getElementById('summary-body'),
  copyFeedback: document.getElementById('copy-feedback'),
  toast: document.getElementById('toast'),
  sealModal: document.getElementById('seal-modal'),
  sealTitleInput: document.getElementById('seal-title-input'),
  sealError: document.getElementById('seal-error'),
  sealSubmitButton: document.getElementById('seal-submit-button'),
};

function setSyncStatus(state, detail) {
  refs.syncStatus.className = `sync-status ${state}`;

  if (state === 'syncing') {
    refs.syncText.textContent = '同步中…';
    return;
  }

  if (state === 'synced') {
    refs.syncText.textContent = '已同步';
    const now = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    refs.lastSync.textContent = `最后同步：${now}`;
    return;
  }

  if (state === 'error') {
    refs.syncText.textContent = detail || '同步失败，将自动重试';
    return;
  }

  refs.syncText.textContent = '连接中…';
}

function showToast(message, tone = 'success') {
  refs.toast.textContent = message;
  refs.toast.dataset.tone = tone;
  refs.toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    refs.toast.classList.remove('visible');
  }, 2600);
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
  if (!response.ok) {
    throw new Error(payload.error || 'archive failed');
  }
  return payload;
}

function applyDataToDOM() {
  document.getElementById('d1name').value = data.d1name;
  document.getElementById('d2name').value = data.d2name;
  document.getElementById('d1date').value = data.d1date;
  document.getElementById('d2date').value = data.d2date;
}

function renderSlots() {
  refs.slots.innerHTML = '';

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
      refs.slots.appendChild(separator);
    }

    const row = document.createElement('div');
    row.className = 'slot-row time-block';

    const label = document.createElement('div');
    label.className = 'time-label hour-mark';
    label.textContent = formatHour(hour);
    row.appendChild(label);

    ['d1', 'd2'].forEach((dayKey) => {
      const wrap = document.createElement('div');
      const value = data.slots[hour][dayKey];
      wrap.className = `slot${value ? ' has-content' : ''}`;

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '添加事项…';
      input.value = value;
      input.addEventListener('input', (event) => {
        data.slots[hour][dayKey] = event.target.value;
        wrap.classList.toggle('has-content', Boolean(event.target.value));
        scheduleSave();
      });

      wrap.appendChild(input);
      row.appendChild(wrap);
    });

    refs.slots.appendChild(row);
  });
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
  if (!window.confirm('确定清空所有内容？所有设备上的当前日程都会被清除。')) return;

  data = emptyData();
  applyDataToDOM();
  renderSlots();
  refs.summaryPanel.classList.remove('visible');

  try {
    await pushSchedule(data);
    setSyncStatus('synced');
    showToast('当前日程已清空。');
  } catch (error) {
    setSyncStatus('error');
    console.error('Clear error:', error);
  }
}

async function submitSeal() {
  if (sealing) return;

  const title = refs.sealTitleInput.value.trim();
  if (!title) {
    refs.sealError.textContent = '请先填写历史事件名称。';
    refs.sealError.classList.remove('hidden');
    refs.sealTitleInput.focus();
    return;
  }

  refs.sealError.classList.add('hidden');
  sealing = true;
  refs.sealSubmitButton.disabled = true;
  refs.sealSubmitButton.textContent = '封印中…';

  try {
    await createArchive(title);
    closeSealModal();
    showToast(`《${title}》已封入历史长河。`);
  } catch (error) {
    refs.sealError.textContent = error.message || '封印失败，请稍后再试。';
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
    window.setTimeout(() => refs.copyFeedback.classList.remove('visible'), 1800);
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
    renderSlots();
    const counts = countEntries(data);
    refs.lastSync.textContent = counts.total
      ? `当前共有 ${counts.total} 条安排`
      : '当前还是一段空白河道';
    setSyncStatus('synced');
  } catch (error) {
    console.error('Init failed:', error);
    applyDataToDOM();
    renderSlots();
    setSyncStatus('error', '无法连接服务');
  } finally {
    refs.overlay.classList.add('hidden');
    window.setTimeout(() => refs.overlay.remove(), 320);
  }
}());
