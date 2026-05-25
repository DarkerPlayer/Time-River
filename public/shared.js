(function () {
  const HOURS = [];
  for (let hour = 6; hour <= 23; hour += 1) HOURS.push(hour);
  for (let hour = 0; hour <= 5; hour += 1) HOURS.push(hour);

  const PERIODS = [
    { hour: 6, label: '上午' },
    { hour: 12, label: '下午' },
    { hour: 18, label: '晚上' },
    { hour: 22, label: '深夜' },
    { hour: 0, label: '凌晨' },
  ];

  function emptyData() {
    const data = { d1name: '', d2name: '', d1date: '', d2date: '', slots: {} };
    HOURS.forEach((hour) => {
      data.slots[hour] = { d1: '', d2: '' };
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
      };
    });

    return base;
  }

  function formatHour(hour) {
    return `${String(hour).padStart(2, '0')}:00`;
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

  function countEntries(data) {
    const merged = mergeScheduleData(data);
    let d1 = 0;
    let d2 = 0;

    HOURS.forEach((hour) => {
      if (merged.slots[hour].d1.trim()) d1 += 1;
      if (merged.slots[hour].d2.trim()) d2 += 1;
    });

    return { d1, d2, total: d1 + d2 };
  }

  function buildSummary(data) {
    const merged = mergeScheduleData(data);
    const d1Name = merged.d1name || '第一天';
    const d2Name = merged.d2name || '第二天';
    const d1Date = merged.d1date ? ` · ${merged.d1date}` : '';
    const d2Date = merged.d2date ? ` · ${merged.d2date}` : '';
    const counts = countEntries(merged);

    let text = `【${d1Name}${d1Date}】\n`;
    HOURS.forEach((hour) => {
      const value = merged.slots[hour].d1.trim();
      if (value) text += `  ${formatHour(hour)}  ${value}\n`;
    });
    if (!counts.d1) text += '  （暂时没有安排）\n';

    text += `\n【${d2Name}${d2Date}】\n`;
    HOURS.forEach((hour) => {
      const value = merged.slots[hour].d2.trim();
      if (value) text += `  ${formatHour(hour)}  ${value}\n`;
    });
    if (!counts.d2) text += '  （暂时没有安排）\n';

    text += `\n共 ${counts.total} 项安排（${d1Name} ${counts.d1} 项 / ${d2Name} ${counts.d2} 项）`;
    return text;
  }

  function defaultArchiveTitle(data) {
    const merged = mergeScheduleData(data);
    const left = merged.d1name.trim() || '第一天';
    const right = merged.d2name.trim() || '第二天';
    const stamp = new Date().toLocaleDateString('zh-CN');
    return `${left} · ${right} · ${stamp}`;
  }

  window.TimeRiver = {
    HOURS,
    PERIODS,
    emptyData,
    mergeScheduleData,
    formatHour,
    formatDateTime,
    countEntries,
    buildSummary,
    defaultArchiveTitle,
  };
}());
