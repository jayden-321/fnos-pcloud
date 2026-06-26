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

test('sync logs expose file size, progress, and uploading status filters', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(html, /<th>大小<\/th>/);
  assert.match(html, /<th>进度<\/th>/);
  assert.match(html, /<option value="uploading">上传中<\/option>/);
  assert.match(script, /uploadToLogRow/);
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
