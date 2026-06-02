(function () {
  const DAY_KEYS = ['d1', 'd2'];
  const HOURS = [];
  const MAX_MERGE_SPAN = 6;
  for (let hour = 6; hour <= 23; hour += 1) HOURS.push(hour);
  for (let hour = 0; hour <= 5; hour += 1) HOURS.push(hour);

  const PERIOD_LABELS = {
    6: '上午',
    12: '中午',
    14: '下午',
    18: '晚上',
    22: '深夜',
    0: '凌晨',
  };

  function emptyMerges() {
    return { d1: {}, d2: {} };
  }

  function emptyData() {
    const data = {
      d1name: '',
      d2name: '',
      d1date: '',
      d2date: '',
      slots: {},
      merges: emptyMerges(),
    };
    HOURS.forEach((hour) => {
      data.slots[hour] = { d1: '', d2: '', d1checked: false, d2checked: false };
    });
    return data;
  }

  function normalizeText(value) {
    return typeof value === 'string' ? value : '';
  }

  function mergeScheduleData(payload) {
    const base = emptyData();
    if (!payload || typeof payload !== 'object') return base;

    base.d1name = normalizeText(payload.d1name);
    base.d2name = normalizeText(payload.d2name);
    base.d1date = normalizeText(payload.d1date);
    base.d2date = normalizeText(payload.d2date);

    HOURS.forEach((hour) => {
      const slot = payload.slots && typeof payload.slots === 'object' ? payload.slots[hour] : null;
      base.slots[hour] = {
        d1: normalizeText(slot && slot.d1),
        d2: normalizeText(slot && slot.d2),
        d1checked: Boolean(slot && slot.d1checked),
        d2checked: Boolean(slot && slot.d2checked),
      };
    });

    const merges = payload.merges && typeof payload.merges === 'object' ? payload.merges : {};
    DAY_KEYS.forEach((dayKey) => {
      const dayMerges = merges[dayKey] && typeof merges[dayKey] === 'object' ? merges[dayKey] : {};
      HOURS.forEach((hour) => {
        const rawSpan = Number(dayMerges[hour]);
        if (Number.isInteger(rawSpan) && rawSpan > 1) {
          base.merges[dayKey][hour] = Math.min(rawSpan, MAX_MERGE_SPAN);
        }
      });
    });

    return base;
  }

  function formatHour(hour) {
    return `${String(hour).padStart(2, '0')}:00`;
  }

  function formatHourRange(startHour, span) {
    if (span <= 1) return formatHour(startHour);
    const endHour = (startHour + span) % 24;
    return `${formatHour(startHour)}~${formatHour(endHour)}`;
  }

  function getPeriodLabel(hour) {
    return PERIOD_LABELS[hour] || '';
  }

  function formatDateTime(timestamp) {
    if (!timestamp) return '未知时间';
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getMaxMergeSpan(data, dayKey, startIndex) {
    const merged = mergeScheduleData(data);
    const startHour = HOURS[startIndex];
    const startValue = merged.slots[startHour][dayKey].trim();
    if (!startValue) return 1;

    let maxSpan = 1;
    for (let index = startIndex + 1; index < HOURS.length; index += 1) {
      const nextValue = merged.slots[HOURS[index]][dayKey].trim();
      if (nextValue) break;
      maxSpan += 1;
    }

    return Math.min(maxSpan, MAX_MERGE_SPAN);
  }

  function getActiveMergeSpan(data, dayKey, startIndex) {
    const merged = mergeScheduleData(data);
    const hour = HOURS[startIndex];
    const rawSpan = Number(merged.merges[dayKey][hour] || 1);
    const maxSpan = getMaxMergeSpan(merged, dayKey, startIndex);
    if (!Number.isFinite(rawSpan) || rawSpan < 1) return 1;
    return Math.min(Math.floor(rawSpan), maxSpan);
  }

  function getDayBlocks(data, dayKey) {
    const merged = mergeScheduleData(data);
    const blocks = [];
    let coveredUntil = -1;

    HOURS.forEach((hour, index) => {
      if (index <= coveredUntil) return;

      const value = merged.slots[hour][dayKey].trim();
      if (!value) return;

      const span = getActiveMergeSpan(merged, dayKey, index);
      if (span > 1) coveredUntil = index + span - 1;
      blocks.push({ hour, value, span, index });
    });

    return blocks;
  }

  function countEntries(data) {
    const merged = mergeScheduleData(data);
    const d1Blocks = getDayBlocks(merged, 'd1');
    const d2Blocks = getDayBlocks(merged, 'd2');
    const d1Hours = d1Blocks.reduce((total, block) => total + block.span, 0);
    const d2Hours = d2Blocks.reduce((total, block) => total + block.span, 0);
    const d1 = d1Blocks.length;
    const d2 = d2Blocks.length;

    return {
      d1,
      d2,
      total: d1 + d2,
      d1Hours,
      d2Hours,
      totalHours: d1Hours + d2Hours,
    };
  }

  function buildSummary(data, options = {}) {
    const merged = mergeScheduleData(data);
    const counts = countEntries(merged);
    const dayHours = options.dayHours || {
      d1: counts.d1Hours,
      d2: counts.d2Hours,
    };
    const totalHours = Number.isFinite(options.totalHours)
      ? options.totalHours
      : (dayHours.d1 + dayHours.d2);

    const d1Name = merged.d1name || '第一天';
    const d2Name = merged.d2name || '第二天';
    const d1Date = merged.d1date ? ` · ${merged.d1date}` : '';
    const d2Date = merged.d2date ? ` · ${merged.d2date}` : '';

    let text = `【${d1Name}${d1Date}】\n`;
    getDayBlocks(merged, 'd1').forEach((block) => {
      const label = block.span > 1 ? formatHourRange(block.hour, block.span) : formatHour(block.hour);
      text += `  ${label}  ${block.value}\n`;
    });
    if (!counts.d1) text += '  （暂时没有安排）\n';

    text += `\n【${d2Name}${d2Date}】\n`;
    getDayBlocks(merged, 'd2').forEach((block) => {
      const label = block.span > 1 ? formatHourRange(block.hour, block.span) : formatHour(block.hour);
      text += `  ${label}  ${block.value}\n`;
    });
    if (!counts.d2) text += '  （暂时没有安排）\n';

    text += `\n共 ${counts.total} 项安排 / ${totalHours} 小时`;
    text += `\n${d1Name}：${counts.d1} 项 / ${dayHours.d1} 小时`;
    text += `\n${d2Name}：${counts.d2} 项 / ${dayHours.d2} 小时`;
    return text;
  }

  function defaultArchiveTitle(data) {
    const merged = mergeScheduleData(data);
    const left = merged.d1name.trim() || '第一天';
    const right = merged.d2name.trim() || '第二天';
    const stamp = new Date().toLocaleDateString('zh-CN');
    return `${left} · ${right} · ${stamp}`;
  }

  function getCurrentRealm() {
    const pathname = window.location.pathname;
    const match = pathname.match(/^\/([一-龥a-z0-9]+(?:-[一-龥a-z0-9]+)*)(?:\/history)?\/?$/);
    return match ? match[1] : null;
  }

  function realmApiUrl(base, realm) {
    if (!realm) return base;
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}realm=${encodeURIComponent(realm)}`;
  }

  function toSlug(value) {
    return normalizeText(value)
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^一-龥a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  window.TimeRiver = {
    DAY_KEYS,
    HOURS,
    MAX_MERGE_SPAN,
    emptyData,
    mergeScheduleData,
    formatHour,
    formatHourRange,
    getPeriodLabel,
    formatDateTime,
    getActiveMergeSpan,
    getDayBlocks,
    countEntries,
    buildSummary,
    defaultArchiveTitle,
    getCurrentRealm,
    realmApiUrl,
    toSlug,
  };
}());
