import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('web UI uses neutral pCloud branding', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const oldBrand = '\u98de\u725b\u540c\u6b65';

  assert.equal(html.includes(oldBrand), false);
  assert.match(html, /<h1>pCloud Sync<\/h1>/);
});

test('sync task cards are compact summaries without folder emoji or repeated path details', async () => {
  const [script, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(script, /folder-icon|📁|<dl>|本地路径|pCloud 路径|同步规则|单向上传/);
  assert.doesNotMatch(styles, /\.folder-icon\b|task-card dl/);
});
