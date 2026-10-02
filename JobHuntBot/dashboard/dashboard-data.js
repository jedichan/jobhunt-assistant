'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DATASETS = {
  preliminary: {
    file: 'preliminary_job_pool.csv', required: true,
    columns: ['lead_id', 'date_found', 'company', 'company_group', 'job_title', 'role_family', 'level', 'location', 'source', 'job_url', 'posted_date', 'application_deadline', 'company_type', 'priority', 'status', 'resume_variant', 'fit_summary', 'eligibility', 'blocker', 'next_action', 'user_decision', 'promoted_at', 'notes'],
  },
  jobs: {
    file: 'job_pool.csv', required: true,
    columns: ['date_found', 'company', 'job_title', 'role_family', 'level', 'location', 'remote_policy', 'source', 'job_url', 'posted_date', 'priority', 'status', 'resume_variant', 'skip_reason', 'blocker', 'next_action', 'notes', 'cohort_match_status', 'current_stage'],
  },
  daily: {
    file: 'daily_dashboard.csv', required: false,
    columns: ['date', 'found_count', 'submitted_count', 'skipped_count', 'blocked_count', 'needs_user_count', 'pending_count', 'top_sources', 'summary', 'user_actions_needed'],
  },
  followUp: {
    file: 'follow_up.csv', required: false,
    columns: ['date', 'company', 'job_title', 'contact', 'channel', 'event_type', 'deadline', 'next_action', 'status', 'notes', 'time'],
  },
};

// RFC 4180 fields, including embedded CRLF, with strict quote validation.
function parseCSV(input) {
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', state = 'start', line = 1, rowLine = 1;
  const fail = message => { throw new Error(`CSV 第 ${line} 行：${message}`); };
  const endField = () => { row.push(field); field = ''; state = 'start'; };
  const endRow = () => {
    endField();
    // Ignore genuinely blank lines, but retain explicitly empty quoted cells.
    rows.push({ cells: row, line: rowLine });
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else {
        field += char;
        if (char === '\n') line++;
      }
      continue;
    }
    if (char === ',') { endField(); continue; }
    if (char === '\r' || char === '\n') {
      if (state !== 'start' || row.length || field.length) endRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
      line++;
      rowLine = line;
      continue;
    }
    if (state === 'closed') fail('结束引号后存在非分隔符字符');
    if (char === '"') {
      if (state !== 'start') fail('未加引号的字段内存在引号');
      state = 'quoted';
    } else {
      field += char;
      state = 'unquoted';
    }
  }
  if (state === 'quoted') fail('字段引号未闭合');
  if (row.length || state !== 'start' || field.length) endRow();
  return rows;
}

function readDataset(root, definition) {
  const filePath = path.join(root, definition.file);
  let text, stat;
  try {
    // Use one descriptor so the metadata and contents refer to the same file.
    const descriptor = fs.openSync(filePath, 'r');
    try {
      text = fs.readFileSync(descriptor, 'utf8');
      stat = fs.fstatSync(descriptor);
    } finally { fs.closeSync(descriptor); }
  } catch (error) {
    throw new Error(`${definition.file} 读取失败（${error.code || 'IO_ERROR'}）`);
  }
  let rows;
  try { rows = parseCSV(text); }
  catch (error) { throw new Error(`${definition.file}：${error.message}`); }
  if (!rows.length) throw new Error(`${definition.file} 缺少表头`);
  const header = rows[0].cells;
  if (header.some(name => !name.trim()) || new Set(header).size !== header.length) {
    throw new Error(`${definition.file} 表头含空列名或重复列名`);
  }
  const missing = definition.columns.filter(name => !header.includes(name));
  if (missing.length) throw new Error(`${definition.file} 缺少字段：${missing.join('、')}`);
  const records = rows.slice(1).map(row => {
    if (row.cells.length !== header.length) {
      throw new Error(`${definition.file} 第 ${row.line} 行应有 ${header.length} 列，实际 ${row.cells.length} 列`);
    }
    return Object.fromEntries(header.map((name, index) => [name, row.cells[index]]));
  });
  return {
    records,
    source: { file: definition.file, modifiedAt: stat.mtime.toISOString(), rowCount: records.length },
  };
}

// Parse an allowlist only; buildOverview further limits the browser response to
// the configured role, status, recurrence and timezone. Prompts stay local.
function parseScheduleMetadata(text) {
  const allowed = new Set(['id', 'name', 'status', 'rrule']);
  const result = {};
  let multiline = null;
  const findClosing = (value, delimiter, from = 0) => {
    for (let index = value.indexOf(delimiter, from); index !== -1; index = value.indexOf(delimiter, index + 3)) {
      let slashes = 0;
      if (delimiter === '"""') for (let j = index - 1; j >= 0 && value[j] === '\\'; j--) slashes++;
      if (slashes % 2 === 0) return index;
    }
    return -1;
  };
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (multiline) {
      if (findClosing(line, multiline) !== -1) multiline = null;
      continue;
    }
    // Automation metadata is a top-level table. Ignore nested tables entirely.
    if (/^\s*\[/.test(line)) break;
    const match = line.match(/^\s*([A-Za-z_][\w-]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    const delimiter = value.startsWith('"""') ? '"""' : value.startsWith("'''") ? "'''" : null;
    if (delimiter) {
      if (allowed.has(key)) throw new Error(`日程字段 ${key} 必须是单行字符串`);
      if (findClosing(value, delimiter, 3) === -1) multiline = delimiter;
      continue;
    }
    if (!allowed.has(key)) continue;
    if (Object.hasOwn(result, key)) throw new Error(`日程字段 ${key} 重复`);
    const quoted = value.match(/^("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/);
    if (!quoted) throw new Error(`日程字段 ${key} 格式无效`);
    try {
      result[key] = quoted[1][0] === '"' ? JSON.parse(quoted[1]) : quoted[1].slice(1, -1);
    } catch { throw new Error(`日程字段 ${key} 转义无效`); }
  }
  if (multiline) throw new Error('日程配置字符串未闭合');
  const missing = [...allowed].filter(key => typeof result[key] !== 'string' || !result[key]);
  if (missing.length) throw new Error(`日程缺少字段：${missing.join('、')}`);
  return { ...result, timezone: 'Asia/Shanghai' };
}

function readScheduleBindings(settingsPath, warnings) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push('自动任务绑定配置无法读取，请检查本地 settings.json。');
    return [];
  }
  const bindings = settings?.automation_ids;
  if (bindings === undefined) return [];
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    warnings.push('自动任务绑定配置必须是包含 screen、gmail 的对象。');
    return [];
  }
  return ['screen', 'gmail'].flatMap(role => {
    const id = bindings[role];
    if (id === undefined || id === '') return [];
    // IDs are directory names, never filesystem paths. Do not echo rejected IDs.
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
      warnings.push(`自动任务 ${role} 的绑定 ID 格式无效。`);
      return [];
    }
    return [{ role, id }];
  });
}

function buildOverview({
  root = __dirname,
  automationRoot = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'automations'),
  settingsPath = path.join(root, '..', 'skills', 'jobhunt-assistant', 'settings.json'),
  now = new Date(),
} = {}) {
  const datasets = {}, sources = {}, warnings = [], schedules = [];
  for (const [key, definition] of Object.entries(DATASETS)) {
    try {
      const { records, source } = readDataset(root, definition);
      datasets[key] = records;
      sources[key] = source;
    } catch (error) {
      if (definition.required) throw error;
      datasets[key] = [];
      sources[key] = { file: definition.file, modifiedAt: null, rowCount: null, error: error.message };
      warnings.push(error.message);
    }
  }
  for (const { role, id } of readScheduleBindings(settingsPath, warnings)) {
    try {
      const directory = fs.realpathSync(automationRoot);
      const file = fs.realpathSync(path.join(directory, id, 'automation.toml'));
      const relative = path.relative(directory, file);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw Object.assign(new Error('Invalid automation path'), { code: 'INVALID_PATH' });
      }
      const { status, rrule, timezone } = parseScheduleMetadata(fs.readFileSync(file, 'utf8'));
      // IDs, custom names, prompts and filesystem paths are not browser data.
      schedules.push({ role, status, rrule, timezone });
    } catch (error) {
      const reason = ['ENOENT', 'EACCES', 'INVALID_PATH'].includes(error.code) ? error.code : 'INVALID_METADATA';
      warnings.push(`自动任务 ${role} 元数据不可用：${reason}`);
    }
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  return {
    generatedAt: now.toISOString(), today: `${parts.year}-${parts.month}-${parts.day}`,
    datasets, sources, schedules, warnings,
  };
}

module.exports = { DATASETS, parseCSV, parseScheduleMetadata, readDataset, buildOverview };
