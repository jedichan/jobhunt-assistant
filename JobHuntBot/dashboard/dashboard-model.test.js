'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./dashboard-model');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATASETS, readDataset } = require('./dashboard-data');

const today = '2026-10-01';
const defaults = { view: 'jobs', scope: 'all', query: '', city: '', type: '', status: '', sort: 'newest' };
const filter = (rows, changes = {}, saved = new Set()) => M.filterJobs(rows, { ...defaults, ...changes }, today, saved);
const lead = changes => ({ lead_id: 'lead-a', company: '甲公司', job_title: 'AI工程师', location: '南京市', job_url: 'https://example.com/jobs/a', date_found: today, status: 'Needs review', priority: 'P1', ...changes });

test('fixture CSV merge counts unique opportunities once and retains all formal-pool statuses', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'job-model-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preliminaryRows = [lead({}), lead({ lead_id: 'lead-b', company: '乙公司', status: 'Needs user', date_found: '2026-09-29' })];
  const jobRows = [lead({ status: 'Submitted' }), lead({ company: '丙公司', status: 'Rejected' })];
  for (const [definition, records] of [[DATASETS.preliminary, preliminaryRows], [DATASETS.jobs, jobRows]]) {
    const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
    fs.writeFileSync(path.join(root, definition.file), [definition.columns.map(cell).join(','), ...records.map(record => definition.columns.map(column => cell(record[column])).join(','))].join('\r\n') + '\r\n');
  }
  const preliminary = readDataset(root, DATASETS.preliminary).records;
  const jobs = readDataset(root, DATASETS.jobs).records;
  const rows = M.mergeJobs(preliminary, jobs);
  const expected = new Map();
  for (const row of [...preliminary, ...jobs]) expected.set(M.key(row), row);
  assert.equal(rows.length, expected.size);
  assert.equal(new Set(rows.map(row => row._id)).size, rows.length);
  assert.equal(rows.filter(row => row._pool === 'jobs').length, new Set(jobs.map(M.key)).size);
  for (const row of rows) assert.equal(row.status, expected.get(M.key(row)).status);
  assert.equal(filter(rows, { scope: 'today' }).length, [...expected.values()].filter(row => row.date_found === today).length);
  for (const status of new Set(rows.map(row => row.status))) {
    assert.equal(filter(rows, { status }).length, [...expected.values()].filter(row => row.status === status).length);
  }
  assert.ok(preliminary.every(row => Object.hasOwn(row, 'lead_id')));
  assert.ok(jobs.every(row => Object.hasOwn(row, 'date_found')));
});

test('formal status wins while preliminary matching evidence and identity survive empty formal fields', () => {
  const preliminary = lead({ fit_summary: '匹配计算机视觉项目', eligibility: '毕业窗口待核验', application_deadline: '2026-10-08' });
  const formal = { ...preliminary, lead_id: '', fit_summary: '', eligibility: '', status: 'Submitted', current_stage: '已收件' };
  const originals = JSON.stringify([preliminary, formal]);
  const rows = M.mergeJobs([preliminary], [formal]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._id, 'lead-a');
  assert.equal(rows[0]._pool, 'jobs');
  assert.equal(rows[0].status, 'Submitted');
  assert.equal(rows[0].fit_summary, '匹配计算机视觉项目');
  assert.equal(rows[0].eligibility, '毕业窗口待核验');
  assert.equal(rows[0].current_stage, '已收件');
  assert.equal(JSON.stringify([preliminary, formal]), originals);
});

test('deduplication preserves separate locations and official job URLs', () => {
  const first = lead({ lead_id: 'one' });
  const second = lead({ lead_id: 'two', location: '上海市' });
  const third = lead({ lead_id: 'three', job_url: 'https://example.com/jobs/b' });
  const same = { ...first, company: ' 甲公司 ', status: 'Pending' };
  const rows = M.mergeJobs([first, second, third], [same]);
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row._id === 'one').status, 'Pending');
});

test('one multi-city opportunity matches each city without losing location caveats', () => {
  const location = '南京/上海/苏州（岗位城市待核验）';
  const rows = M.mergeJobs([lead({ location })], []);
  for (const city of ['南京', '上海', '苏州']) assert.equal(filter(rows, { city }).length, 1);
  assert.equal(filter(rows, { city: '无锡' }).length, 0);
  assert.equal(rows[0].location, location);
});

test('deadlines use only complete valid calendar dates and include the final date', () => {
  for (const value of ['', '未说明', '招满即止', '2026-11', '2026-11（网申8-11月）', '2026-02-30', '2026-13-01']) {
    assert.equal(M.exactDate(value), null, value);
    assert.equal(M.deadline({ application_deadline: value }, today), null, value);
  }
  assert.deepEqual(M.deadline({ application_deadline: '2026-09-30' }, today), { date: '2026-09-30', days: -1 });
  assert.deepEqual(M.deadline({ application_deadline: today }, today), { date: today, days: 0 });
  assert.deepEqual(M.deadline({ application_deadline: '2026-10-08' }, today), { date: '2026-10-08', days: 7 });
  assert.equal(M.exactDate('2026-10-11 24:00'), '2026-10-11');
  assert.equal(M.exactDate('2028-02-29'), '2028-02-29');
  assert.equal(M.exactDate('2027-02-29'), null);
});

test('source links accept HTTP(S) and reject active or local URL schemes', () => {
  assert.equal(M.safeURL('https://example.com/jobs?a=1&b=2'), 'https://example.com/jobs?a=1&b=2');
  assert.equal(M.safeURL('http://example.com/job'), 'http://example.com/job');
  for (const value of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/secret', '//example.com/job', '/jobs/1', 'not a URL', '']) {
    assert.equal(M.safeURL(value), null, value);
  }
});

test('filters compose city, type, status, search, priority and browser-local saved IDs', () => {
  const rows = M.mergeJobs([
    lead({ lead_id: 'one', company_type: '中央企业科技子公司', fit_summary: 'RAG 与数据项目匹配' }),
    lead({ lead_id: 'two', company: '乙公司', company_type: '外资工业科技', priority: 'P2', status: 'Preliminary', date_found: '2026-09-29' }),
  ], []);
  assert.deepEqual(filter(rows, { city: '南京', type: 'soe', status: 'Needs review', query: ' rag ', scope: 'p1' }).map(row => row._id), ['one']);
  assert.deepEqual(filter(rows, { type: 'foreign' }).map(row => row._id), ['two']);
  assert.deepEqual(filter(rows, { scope: 'saved' }, new Set(['two', 'missing-id'])).map(row => row._id), ['two']);
  assert.equal(filter(rows, { scope: 'saved' }).length, 0);
  assert.deepEqual(filter(rows, { scope: 'today' }).map(row => row._id), ['one']);
  assert.equal(filter(rows, { query: '不存在的关键词' }).length, 0);
});

test('sorts newest, priority and complete deadlines without mutating input order', () => {
  const rows = M.mergeJobs([
    lead({ lead_id: 'older-p1', company: '甲', date_found: '2026-09-25', priority: 'P1', application_deadline: '未说明' }),
    lead({ lead_id: 'new-p2', company: '乙', date_found: today, priority: 'P2', application_deadline: '2026-10-05' }),
    lead({ lead_id: 'new-p1', company: '丙', date_found: today, priority: 'P1', application_deadline: '2026-10-08' }),
  ], []);
  const before = JSON.stringify(rows);
  assert.deepEqual(filter(rows).map(row => row._id), ['new-p1', 'new-p2', 'older-p1']);
  assert.deepEqual(filter(rows, { sort: 'priority' }).map(row => row._id), ['new-p1', 'older-p1', 'new-p2']);
  assert.deepEqual(filter(rows, { sort: 'deadline' }).map(row => row._id), ['new-p2', 'new-p1', 'older-p1']);
  assert.equal(JSON.stringify(rows), before);
});

test('progress view contains the formal pool and supports an explicit submitted-only filter', () => {
  const rows = M.mergeJobs([lead({ lead_id: 'preliminary' })], [
    lead({ lead_id: 'pending', company: '待推进公司', status: 'Pending' }),
    lead({ lead_id: 'submitted', company: '已投递公司', status: 'Submitted' }),
  ]);
  assert.deepEqual(filter(rows, { view: 'applied' }).map(row => row._id).sort(), ['pending', 'submitted']);
  assert.deepEqual(filter(rows, { view: 'applied', status: 'Submitted' }).map(row => row._id), ['submitted']);
  assert.equal(M.statusNames['Needs review'], '待核验');
  assert.equal(M.statusNames.Submitted, '已投递');
});
