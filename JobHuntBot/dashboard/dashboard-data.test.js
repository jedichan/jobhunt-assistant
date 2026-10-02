'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { DATASETS, parseCSV, parseScheduleMetadata, readDataset, buildOverview } = require('./dashboard-data');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'job-dashboard-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const definition of Object.values(DATASETS)) {
    fs.writeFileSync(path.join(directory, definition.file), definition.columns.join(',') + '\r\n');
  }
  for (const id of ['screen-test', 'mail-test']) {
    fs.mkdirSync(path.join(directory, id));
    fs.writeFileSync(path.join(directory, id, 'automation.toml'), `id = "${id}"\nname = "测试日程"\nstatus = "ACTIVE"\nrrule = "FREQ=DAILY;BYHOUR=20"\nprompt = "private prompt"\n`);
  }
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ automation_ids: { screen: 'screen-test', gmail: 'mail-test' } }));
  return directory;
}

function overviewOptions(root) {
  return { root, automationRoot: root, settingsPath: path.join(root, 'settings.json') };
}

test('CSV preserves commas, escaped quotes, CRLF and embedded newlines with a BOM', () => {
  const rows = parseCSV('\uFEFFid,note\r\n1,"a,b\r\nsecond ""quote"""\r\n2,\r\n');
  assert.deepEqual(rows.map(row => row.cells), [['id', 'note'], ['1', 'a,b\r\nsecond "quote"'], ['2', '']]);
  assert.equal(rows[2].line, 4);
  assert.deepEqual(parseCSV('a,b\n"",').map(row => row.cells), [['a', 'b'], ['', '']]);
});

test('CSV rejects unterminated, misplaced and trailing quote content', () => {
  assert.throws(() => parseCSV('a,b\n1,"broken'), /未闭合/);
  assert.throws(() => parseCSV('a,b\n1,no"quote'), /字段内存在引号/);
  assert.throws(() => parseCSV('a,b\n1,"ok"garbage'), /结束引号/);
});

test('dataset errors distinguish missing columns, duplicate columns, and row width', t => {
  const root = fixture(t);
  const definition = { file: 'sample.csv', columns: ['id', 'note'] };
  const file = path.join(root, definition.file);
  fs.writeFileSync(file, 'id,note\n1\n');
  assert.throws(() => readDataset(root, definition), /第 2 行应有 2 列，实际 1 列/);
  fs.writeFileSync(file, 'id,missing\n1,2\n');
  assert.throws(() => readDataset(root, definition), /缺少字段：note/);
  fs.writeFileSync(file, 'id,id\n1,2\n');
  assert.throws(() => readDataset(root, definition), /重复列名/);
});

test('overview uses Shanghai date and exposes only public schedule metadata', t => {
  const root = fixture(t);
  const overview = buildOverview({ ...overviewOptions(root), now: new Date('2026-09-30T17:00:00.000Z') });
  assert.equal(overview.today, '2026-10-01');
  assert.equal(overview.generatedAt, '2026-09-30T17:00:00.000Z');
  assert.deepEqual(Object.keys(overview.datasets), ['preliminary', 'jobs', 'daily', 'followUp']);
  assert.equal(overview.sources.preliminary.rowCount, 0);
  assert.ok(overview.sources.preliminary.modifiedAt);
  assert.equal(overview.schedules.length, 2);
  assert.deepEqual(Object.keys(overview.schedules[0]).sort(), ['role', 'rrule', 'status', 'timezone']);
  assert.ok(!JSON.stringify(overview).includes('private prompt'));
  assert.ok(!JSON.stringify(overview).includes('测试日程'));
  assert.ok(!JSON.stringify(overview).includes('mail-test'));
  assert.deepEqual(overview.schedules.map(schedule => schedule.role), ['screen', 'gmail']);
  assert.ok(!JSON.stringify(overview).includes(root));
  assert.deepEqual(overview.warnings, []);
});

test('required datasets fail explicitly; optional datasets downgrade with warnings', t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'daily_dashboard.csv'));
  let overview = buildOverview(overviewOptions(root));
  assert.deepEqual(overview.datasets.daily, []);
  assert.equal(overview.sources.daily.rowCount, null);
  assert.match(overview.warnings[0], /daily_dashboard.csv 读取失败（ENOENT）/);
  fs.writeFileSync(path.join(root, 'follow_up.csv'), 'bad_header\n');
  overview = buildOverview(overviewOptions(root));
  assert.equal(overview.warnings.length, 2);
  fs.unlinkSync(path.join(root, 'preliminary_job_pool.csv'));
  assert.throws(() => buildOverview(overviewOptions(root)), /preliminary_job_pool.csv 读取失败/);
});

test('schedule parser skips multiline prompts, comments, and nested tables', () => {
  const metadata = parseScheduleMetadata([
    'id = "automation"', 'prompt = """', 'name = "secret prompt name"', '"""',
    'name = "Daily \\"jobs\\"" # comment', "status = 'ACTIVE'", 'rrule = "FREQ=DAILY"',
    '[private]', 'name = "private table"',
  ].join('\n'));
  assert.equal(metadata.name, 'Daily "jobs"');
  assert.equal(metadata.id, 'automation');
  assert.throws(() => parseScheduleMetadata('id = "automation"\nprompt = """\nname = "secret"'), /未闭合/);
});

test('unreadable schedules are explicit warnings without paths', t => {
  const root = fixture(t);
  const overview = buildOverview({ ...overviewOptions(root), automationRoot: path.join(root, 'unavailable') });
  assert.deepEqual(overview.schedules, []);
  assert.equal(overview.warnings.length, 2);
  assert.ok(overview.warnings.every(warning => warning.includes('ENOENT') && !warning.includes(root)));
});

test('HTTP overview is fresh, rejects malformed/traversing paths and retains POST validation', async t => {
  const root = fixture(t);
  // All reads and mutations use disposable data; never the user's job records.
  const server = require('./server').createDashboardServer(overviewOptions(root));
  fs.copyFileSync(path.join(__dirname, 'dashboard-data.js'), path.join(root, 'dashboard-data.js'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (url, method = 'GET', body) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: url, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const overview = await request('/api/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.headers['cache-control'], 'no-store');
  assert.ok(Array.isArray(JSON.parse(overview.body).datasets.preliminary));
  assert.equal((await request('/%E0%A4%A')).status, 400);
  assert.equal((await request('/%00')).status, 400);
  assert.equal((await request('/../dashboard-private/secret')).status, 403);
  assert.equal((await request('/%2e%2e/secret')).status, 403);
  const js = await request('/dashboard-data.js');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /javascript/);
  const invalidPost = await request('/api/update-status', 'POST', JSON.stringify({ status: 'Invalid' }));
  assert.equal(invalidPost.status, 400);
  assert.match(JSON.parse(invalidPost.body).error, /status must be/);
});


test('unconfigured automations are normal and do not expose existing schedules', t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'settings.json'));
  for (const settings of [undefined, {}, { automation_ids: {} }]) {
    if (settings) fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify(settings));
    const overview = buildOverview(overviewOptions(root));
    assert.deepEqual(overview.schedules, []);
    assert.deepEqual(overview.warnings, []);
  }
});

test('invalid bindings and symlink escapes cannot read other files or reveal their paths', t => {
  const root = fixture(t);
  for (const id of ['../private', '/private/path', 'folder/name', '..', 'name\\child', 123]) {
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ automation_ids: { screen: id } }));
    const overview = buildOverview(overviewOptions(root));
    assert.deepEqual(overview.schedules, []);
    assert.deepEqual(overview.warnings, ['自动任务 screen 的绑定 ID 格式无效。']);
  }
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'job-dashboard-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'automation.toml'), 'private data');
  fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ automation_ids: { screen: 'escape' } }));
  const overview = buildOverview(overviewOptions(root));
  assert.deepEqual(overview.schedules, []);
  assert.deepEqual(overview.warnings, ['自动任务 screen 元数据不可用：INVALID_PATH']);
  assert.ok(!JSON.stringify(overview).includes(outside));
});

test('malformed settings never echo private input', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'settings.json'), '{ private content');
  const overview = buildOverview(overviewOptions(root));
  assert.deepEqual(overview.schedules, []);
  assert.equal(overview.warnings.length, 1);
  assert.ok(!JSON.stringify(overview).includes('private content'));
});


test('occupied ports cause a clear failure without touching the running service', async t => {
  const { spawn } = require('child_process');
  const sentinel = http.createServer((req, res) => res.end('existing service'));
  await new Promise((resolve, reject) => {
    sentinel.once('error', reject);
    sentinel.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => sentinel.close(resolve)));
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, JOBHUNT_PORT: String(sentinel.address().port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 1);
  assert.match(output, /已被占用/);
  assert.match(output, /不会干扰已有服务/);
  const text = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: sentinel.address().port }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
  assert.equal(text, 'existing service');
});
