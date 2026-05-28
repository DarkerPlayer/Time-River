const {
  DAY_KEYS,
  HOURS,
  MAX_MERGE_SPAN,
  emptyData,
  mergeScheduleData,
  formatHour,
  formatHourRange,
  getPeriodLabel,
  getActiveMergeSpan,
  countEntries,
  buildSummary,
  defaultArchiveTitle,
} = window.TimeRiver;

const LEGACY_MERGE_STORAGE_KEY = 'time-river-display-merges';

let data = emptyData();
let saveTimer = null;
let sealing = false;
let activeMobileDay = 'd1';

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
  plannerGrid: document.getElementById('days-grid-main'),
  mobileDayButtons: Array.from(document.querySelectorAll('[data-day-switch]')),
  d1Column: document.getElementById('day-column-d1'),
  d2Column: document.getElementById('day-column-d2'),
  expandBackdrop: document.getElementById('slot-expand-backdrop'),
  expandTitle: document.getElementById('slot-expand-title'),
  expandTextarea: document.getElementById('slot-expand-textarea'),
  expandClose: document.getElementById('slot-expand-close'),
};

let expandCallback = null;

function loadLegacyMergeState() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEGACY_MERGE_STORAGE_KEY) || '{}');
    return {
      d1: parsed.d1 && typeof parsed.d1 === 'object' ? parsed.d1 : {},
      d2: parsed.d2 && typeof parsed.d2 === 'object' ? parsed.d2 : {},
    };
  } catch {
    return { d1: {}, d2: {} };
  }
}

function hasStoredMerges(merges) {
  return DAY_KEYS.some((dayKey) => Object.keys(merges[dayKey] || {}).length > 0);
}

function ensureMergeState() {
  if (!data.merges || typeof data.merges !== 'object') {
    data.merges = { d1: {}, d2: {} };
  }
  DAY_KEYS.forEach((dayKey) => {
    if (!data.merges[dayKey] || typeof data.merges[dayKey] !== 'object') {
      data.merges[dayKey] = {};
    }
  });
  return data.merges;
}

function hydrateLegacyMergeState() {
  const legacyState = loadLegacyMergeState();
  if (!hasStoredMerges(legacyState)) return;
  if (hasStoredMerges(ensureMergeState())) return;

  data.merges = mergeScheduleData({ merges: legacyState }).merges;
  cleanupMergeState();

  try {
    window.localStorage.removeItem(LEGACY_MERGE_STORAGE_KEY);
  } catch {
    // Ignore localStorage failures and keep runtime state available.
  }
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

function openExpandPanel(hour, dayKey, currentValue, onSave) {
  const period = getPeriodLabel(hour);
  const dayName = dayKey === 'd1' ? '第一天' : '第二天';
  refs.expandTitle.textContent = `${dayName} · ${period || hour}`;

  refs.expandTextarea.value = currentValue;
  refs.expandBackdrop.classList.add('visible');
  document.body.style.overflow = 'hidden';

  expandCallback = onSave;

  setTimeout(() => refs.expandTextarea.focus(), 100);
}

function closeExpandPanel() {
  if (expandCallback && refs.expandTextarea.value !== refs.expandTextarea.defaultValue) {
    expandCallback(refs.expandTextarea.value);
  }
  refs.expandBackdrop.classList.remove('visible');
  document.body.style.overflow = '';
  expandCallback = null;
  renderColumns();
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

  return Math.min(maxSpan, MAX_MERGE_SPAN);
}

function getActiveSpan(dayKey, startIndex) {
  return getActiveMergeSpan(data, dayKey, startIndex);
}

function cleanupMergeState() {
  const merges = ensureMergeState();
  let changed = false;

  DAY_KEYS.forEach((dayKey) => {
    HOURS.forEach((hour, index) => {
      const value = data.slots[hour][dayKey].trim();
      if (!value) {
        if (hour in merges[dayKey]) {
          delete merges[dayKey][hour];
          changed = true;
        }
        return;
      }

      const span = getActiveSpan(dayKey, index);
      if (span <= 1) {
        if (hour in merges[dayKey]) {
          delete merges[dayKey][hour];
          changed = true;
        }
        return;
      }

      if (Number(merges[dayKey][hour]) !== span) {
        merges[dayKey][hour] = span;
        changed = true;
      }
    });
  });

  return changed;
}

function getDisplayHourCounts() {
  const counts = countEntries(data);
  return {
    d1: counts.d1Hours,
    d2: counts.d2Hours,
  };
}

function createTimeStamp(hour, span) {
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

    root.appendChild(createTimeStamp(hour, span));

    const slot = document.createElement('div');
    slot.className = `slot-card${value ? ' has-content' : ''}`;
    slot.style.gridRow = `${index + 1} / span ${span}`;

    // 移动端文本预览
    const isMobile = window.innerWidth <= 720;
    if (isMobile) {
      if (value) {
        const preview = document.createElement('div');
        preview.className = 'slot-text-preview';
        preview.textContent = value;
        slot.appendChild(preview);
      }

      // 点击展开弹窗（空白格子也可点击）
      slot.addEventListener('click', () => {
        const preview = slot.querySelector('.slot-text-preview');
        openExpandPanel(hour, dayKey, data.slots[hour][dayKey], (newValue) => {
          data.slots[hour][dayKey] = newValue;
          if (preview) preview.textContent = newValue;
          slot.classList.toggle('has-content', Boolean(newValue.trim()));
          // 如果输入了内容但没有预览元素，刷新列表
          if (newValue.trim() && !preview) renderColumns();
          scheduleSave();
        });
      });
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'slot-input';
    textarea.rows = 1;
    textarea.value = data.slots[hour][dayKey];
    textarea.addEventListener('input', (event) => {
      data.slots[hour][dayKey] = event.target.value;
      slot.classList.toggle('has-content', Boolean(event.target.value.trim()));
      // 更新预览文本
      const preview = slot.querySelector('.slot-text-preview');
      if (preview) preview.textContent = event.target.value;
      scheduleSave();
    });
    textarea.addEventListener('blur', () => {
      const changed = cleanupMergeState();
      renderColumns();
      if (changed) scheduleSave();
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
          const merges = ensureMergeState();
          if (nextSpan <= 1) delete merges[dayKey][hour];
          else merges[dayKey][hour] = nextSpan;
          renderColumns();
          scheduleSave();
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

function setMobileDay(dayKey) {
  activeMobileDay = DAY_KEYS.includes(dayKey) ? dayKey : 'd1';
  refs.plannerGrid.dataset.activeDay = activeMobileDay;
  refs.mobileDayButtons.forEach((button) => {
    const isActive = button.dataset.daySwitch === activeMobileDay;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
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
    cleanupMergeState();

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
  const dayHours = getDisplayHourCounts();
  refs.summaryBody.textContent = buildSummary(data, {
    dayHours,
    totalHours: dayHours.d1 + dayHours.d2,
  });
  refs.summaryPanel.classList.add('visible');
  refs.summaryPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function clearAll() {
  if (!window.confirm('确定清空当前日程吗？')) return;

  data = emptyData();
  applyDataToDOM();
  renderColumns();
  setMobileDay(activeMobileDay);
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
    cleanupMergeState();
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

  refs.mobileDayButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setMobileDay(button.dataset.daySwitch);
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

  // 展开弹窗事件
  refs.expandClose.addEventListener('click', closeExpandPanel);
  refs.expandBackdrop.addEventListener('click', (event) => {
    if (event.target === refs.expandBackdrop) closeExpandPanel();
  });
  refs.expandTextarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeExpandPanel();
  });
}

(async function init() {
  bindStaticEvents();

  try {
    const result = await fetchSchedule();
    if (result.data) data = mergeScheduleData(result.data);
    hydrateLegacyMergeState();
    applyDataToDOM();
    renderColumns();
    setMobileDay(activeMobileDay);
    const counts = countEntries(data);
    refs.lastSync.textContent = counts.totalHours
      ? `共 ${counts.totalHours} 小时`
      : '今天还没有安排';
    setSyncStatus('synced');
  } catch (error) {
    console.error('Init failed:', error);
    hydrateLegacyMergeState();
    applyDataToDOM();
    renderColumns();
    setMobileDay(activeMobileDay);
    setSyncStatus('error', '无法连接');
  } finally {
    refs.overlay.classList.add('hidden');
    window.setTimeout(() => refs.overlay.remove(), 320);
  }
}());
