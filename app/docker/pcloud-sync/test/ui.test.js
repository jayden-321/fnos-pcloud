import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('web UI uses neutral pCloud branding', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const oldBrand = '\u98de\u725b\u540c\u6b65';
  const oldDotsClass = ['window', 'dots'].join('-');

  assert.equal(html.includes(oldBrand), false);
  assert.equal(html.includes(oldDotsClass), false);
  assert.doesNotMatch(html, /<h1>/);
});

test('sync task cards are compact summaries without folder emoji or repeated path details', async () => {
  const [script, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(script, /folder-icon|📁|<dl>|本地路径|pCloud 路径|同步规则|单向上传/);
  assert.doesNotMatch(styles, /\.folder-icon\b|task-card dl/);
});

test('settings prioritizes task config and exposes log retention controls', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.ok(html.indexOf('任务配置') < html.indexOf('pCloud 授权'));
  assert.ok(html.indexOf('pCloud 授权') < html.indexOf('同步规则'));
  assert.doesNotMatch(html, /默认 pCloud 根目录|name="remoteRoot"/);
  assert.match(html, /name="logRetentionDays"/);
  assert.match(html, /name="logRetentionCount"/);
  assert.match(html, /id="clearEvents"/);
  assert.match(html, /pCloud 官方文档未声明推荐并发/);
});

test('settings exposes official pCloud upload and checksum options', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);

  assert.match(html, /name="renameIfExists"/);
  assert.match(html, /name="checksumMode"/);
  assert.match(html, /name="checksumSamplePercent"/);
  assert.match(html, /name="mtimeVerifyConcurrency"/);
  assert.match(html, /name="timezone"/);
  assert.match(html, /失败后校验/);
  assert.match(html, /抽样校验/);
  assert.match(html, /全部校验/);
  assert.match(html, /时间不同校验并发数/);
  assert.match(html, /定时任务时区/);
  assert.match(script, /renameIfExists/);
  assert.match(script, /checksumMode/);
  assert.match(script, /checksumSamplePercent/);
  assert.match(script, /mtimeVerifyConcurrency/);
  assert.doesNotMatch(html, /name="encryptionEnabled"|id="exportEncryptionKey"/);
  assert.doesNotMatch(script, /\/api\/encryption\//);
  assert.match(script, /scheduleTimezoneValue/);
});

test('web UI exposes Restic snapshot browse, download, zip, and restore actions', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(html, /data-tab="decrypt"|id="decryptRows"/);
  assert.match(html, /data-tab="restic"/);
  assert.match(html, /id="resticRows"/);
  assert.match(html, /id="resticDownloadFolder"/);
  assert.match(html, /id="resticRestore"/);
  assert.match(html, /id="resticRebuildIndex"/);
  assert.match(html, /id="resticIndexStatus"/);
  assert.match(html, /id="resticJobDetails"/);
  assert.match(script, /loadResticSnapshots/);
  assert.match(script, /\/api\/restic\/browse/);
  assert.match(script, /\/api\/restic\/download/);
  assert.match(script, /\/api\/restic\/restore/);
  assert.match(script, /\/api\/restic\/index\/rebuild/);
  assert.match(script, /window\.open\(url, '_blank', 'noopener'\)/);
  assert.match(script, /恢复信息已生成，请查看浏览器下载记录或新窗口/);
  assert.match(script, /当前处理文件/);
  assert.match(script, /当前速度/);
  assert.match(script, /平均速度/);
  assert.match(script, /预计剩余/);
  assert.match(script, /最后活动/);
  assert.match(script, /recentErrors/);
});

test('settings exposes pCloud upload and download speed test controls', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);

  assert.match(html, /id="speedTestSize"/);
  assert.match(html, /id="startSpeedTest"/);
  assert.match(html, /上传速度/);
  assert.match(html, /下载速度/);
  assert.match(script, /startSpeedTest/);
  assert.match(script, /renderSpeedTest/);
  assert.match(script, /formatProgress/);
  assert.match(script, /downloadProgress/);
  assert.match(script, /\/api\/speed-test/);
});

test('sync logs expose file size, progress, and uploading status filters', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(html, /<th>大小<\/th>/);
  assert.match(html, /<th>进度<\/th>/);
  assert.doesNotMatch(html, /<th>事件<\/th>/);
  assert.match(html, /<option value="uploading">上传中<\/option>/);
  assert.match(script, /uploadToLogRow/);
  assert.match(script, /colspan="6"/);
  assert.doesNotMatch(script, /row\.eventText/);
});

test('task metrics include a separate existing-file count', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);

  assert.match(html, /id="statExisting"/);
  assert.match(html, />已存在</);
  assert.match(script, /statExisting/);
  assert.match(script, /stats\.existing/);
});

test('task dashboard omits the live upload speed metric', async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(html, /id="statSpeed"/);
  assert.doesNotMatch(script, /statSpeed|uploadSpeedBytesPerSecond/);
  assert.match(styles, /grid-template-columns: repeat\(6, minmax\(108px, 1fr\)\)/);
});

test('web UI exposes current-task metrics and task schedule controls', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);

  assert.match(html, /id="metricScope"/);
  assert.match(script, /currentTaskId/);
  assert.match(script, /taskStats/);
  assert.match(script, /task-stat-grid/);
  assert.match(script, /scheduleType/);
  assert.match(script, /scheduleTime/);
  assert.match(script, /scheduleWeekdays/);
  assert.match(script, /每天/);
  assert.match(script, /每周/);
});

test('queue panel exposes a safe clear action', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);

  assert.match(html, /id="clearQueue"/);
  assert.match(script, /del\('\/api\/queue'\)/);
  assert.match(script, /不会删除 NAS 或 pCloud 文件/);
});

test('manual scan button reports when there are no enabled sync tasks', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);

  assert.match(html, /id="forceRemoteScan"/);
  assert.match(script, /runScan\(\{ forceRemoteScan: false }\)/);
  assert.match(script, /runScan\(\{ forceRemoteScan: true }\)/);
  assert.match(script, /scanResult\.skipped/);
  assert.match(script, /没有可扫描的同步任务/);
});

test('task cards show scan source labels from engine queue state', async () => {
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(script, /scanModeText/);
  assert.match(script, /scanDetailText/);
  assert.match(script, /远端全量比对/);
  assert.match(script, /本地缓存/);
  assert.match(script, /扫描依据/);
  assert.match(script, /本地扫描/);
  assert.match(script, /远端列举/);
  assert.match(script, /时间不同/);
  assert.match(script, /时间不同已校验/);
  assert.match(script, /内容不一致/);
  assert.match(script, /verify-mtime/);
  assert.match(script, /verifyMtimeMismatches/);
  assert.match(script, /\/api\/verify-mtime-mismatches/);
});

test('task cards expose a compact mtime verification menu and details dialog', async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8')
  ]);

  assert.match(html, /id="mtimeDetailsDialog"/);
  assert.match(html, /id="mtimeDetailsRows"/);
  assert.match(script, /data-action="mtime-menu"/);
  assert.match(script, /全部校验时间不同/);
  assert.match(script, /暂停校验/);
  assert.match(script, /查看内容不一致/);
  assert.match(script, /查看校验失败/);
  assert.match(script, /loadMtimeMismatchDetails/);
  assert.match(script, /stopMtimeMismatchVerification/);
  assert.match(script, /resolveMtimeMismatch/);
  assert.match(script, /data-mtime-resolution="upload_local"/);
  assert.match(script, /data-mtime-resolution="download_remote"/);
  assert.match(script, /\/api\/mtime-mismatches\/resolve/);
  assert.match(script, /\/api\/verify-mtime-mismatches\/stop/);
  assert.match(script, /\/api\/mtime-mismatches/);
  assert.match(styles, /task-action-select/);
  assert.match(styles, /mtime-details-table/);
  assert.match(styles, /resolution-actions/);
});

test('task schedule form hides fields that do not apply to the selected schedule type', async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(html, /name="intervalSeconds"/);
  assert.doesNotMatch(html, /扫描间隔秒/);
  assert.doesNotMatch(script, /fields\.intervalSeconds/);
  assert.match(script, /data-schedule-field="interval"/);
  assert.match(script, /data-schedule-field="time"/);
  assert.match(script, /data-schedule-field="weekly"/);
  assert.match(script, /updateScheduleVisibility/);
  assert.match(script, /field\.hidden = fieldName === 'interval' \? type !== 'interval'/);
  assert.match(script, /fieldName === 'time' \? !\['daily', 'weekly'\]\.includes\(type\)/);
  assert.match(script, /type !== 'weekly'/);
  assert.match(styles, /\[hidden\]\s*{\s*display:\s*none\s*!important;?\s*}/);
});

test('web UI exposes stop sync and opens pCloud picker from the selected folder or root', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);

  assert.match(html, /id="stopSync"/);
  assert.match(script, /\/api\/stop/);
  assert.doesNotMatch(script, /fields\.remoteRoot|remoteRoot:|name="remoteRoot"/);
  assert.match(script, /initialPath: editor\.querySelector\('\[name="remotePath"\]'\)\.value/);
  assert.match(script, /\/api\/pcloud\/folders\?path=\$\{encodeURIComponent\(targetPath \|\| '\/'\)\}/);
});
