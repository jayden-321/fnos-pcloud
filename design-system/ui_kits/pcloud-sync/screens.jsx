// pCloud NAS Sync — screens. Composes the design-system component primitives.
const DS = window.PCloudNASSyncDesignSystem_4c073a;
const { Button, NavItem, TaskCard, MetricCard, Panel, StatusPill, Field, Input, Select, Textarea } = DS;

const TABS = [
  { id: 'tasks', label: '同步任务' },
  { id: 'logs', label: '同步日志' },
  { id: 'settings', label: '设置' },
];

function Sidebar({ tab, onTab, onCreate }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="../../assets/app-icon-256.png" alt="" />
        <b>pCloud NAS Sync</b>
      </div>
      <nav>
        {TABS.map((t) => (
          <NavItem key={t.id} active={tab === t.id} onClick={() => onTab(t.id)}>{t.label}</NavItem>
        ))}
      </nav>
      <div style={{ marginTop: 'auto' }}>
        <Button variant="link" fullWidth style={{ justifyContent: 'flex-start' }} onClick={onCreate}>
          ＋ 创建新任务
        </Button>
      </div>
    </aside>
  );
}

function TasksScreen({ data, onScan, onForce, onStop, onRetry, onLogs, onEdit }) {
  const t = data.totals;
  const metrics = [
    { v: t.total.toLocaleString(), l: '总文件' },
    { v: t.synced, l: '已成功', tone: 'success' },
    { v: t.existing.toLocaleString(), l: '已存在' },
    { v: t.failed, l: '失败', tone: 'danger' },
    { v: t.pending, l: '待上传' },
    { v: t.uploading, l: '上传中', tone: 'accent' },
    { v: t.speed, l: '上传速度', tone: 'accent' },
  ];
  const queue = [
    { status: 'failed', key: 'work/contracts/lease-final.pdf', error: '上传超时（已重试 2 次）' },
    { status: 'pending', key: 'photos/2026/IMG_4822.HEIC', error: '' },
    { status: 'pending', key: 'photos/2026/IMG_4823.HEIC', error: '' },
    { status: 'uploading', key: 'photos/2026/IMG_4821.HEIC', error: '' },
  ];
  return (
    <>
      <header className="workspace-header">
        <div>
          <h2>同步任务</h2>
          <p className="ver">v{data.version}</p>
        </div>
        <div className="actions">
          <Button onClick={onScan}>立即扫描</Button>
          <Button variant="soft" onClick={onForce}>远端重新比对</Button>
          <Button variant="soft" onClick={onStop}>停止同步</Button>
          <Button variant="soft" onClick={onRetry}>重试失败</Button>
        </div>
      </header>

      <p className="metric-scope">全部任务</p>
      <section className="metrics">
        {metrics.map((m) => <MetricCard key={m.l} value={m.v} label={m.l} tone={m.tone} />)}
      </section>

      <section className="task-list">
        {data.tasks.map((task) => (
          <TaskCard
            key={task.id}
            name={task.name}
            status={task.status}
            statusLabel={task.statusLabel}
            scanMode={task.scanMode}
            scanDetail={task.scanDetail}
            stats={task.stats}
            actions={<>
              <Button variant="soft" onClick={() => onLogs(task)}>查看日志</Button>
              <Button variant="soft" onClick={() => onEdit(task)}>编辑</Button>
            </>}
          />
        ))}
      </section>

      <Panel title="队列状态">
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ width: 92 }}>状态</th><th>文件</th><th>原因</th></tr></thead>
            <tbody>
              {queue.map((r, i) => (
                <tr key={i}>
                  <td><StatusPill status={r.status}>{{ failed: '失败', pending: '待上传', uploading: '上传中' }[r.status]}</StatusPill></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.key}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function LogsScreen({ data }) {
  const [status, setStatus] = React.useState('');
  const [search, setSearch] = React.useState('');
  const rows = data.logs
    .filter((r) => !status || r.status === status)
    .filter((r) => !search || r.file.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <header className="workspace-header"><div><h2>同步日志</h2><p className="ver">v{data.version}</p></div></header>
      <Panel padding={0} style={{ overflow: 'hidden' }}>
        <div className="log-toolbar">
          <Select defaultValue=""><option value="">全部任务</option><option>finance</option><option>photos</option><option>work</option></Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option><option value="uploading">上传中</option><option value="success">成功</option><option value="failed">失败</option>
          </Select>
          <Input placeholder="搜索文件名称" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table className="log-table">
            <thead><tr><th>文件名称</th><th>大小</th><th>任务</th><th>时间</th><th>状态</th><th>进度</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.file}</td>
                  <td>{r.size}</td>
                  <td>{r.task}</td>
                  <td>{r.time}</td>
                  <td><StatusPill status={r.status}>{r.statusText}</StatusPill></td>
                  <td>{r.progress}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>暂无文件同步日志</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function SpeedTestPanel({ onToast }) {
  const [size, setSize] = React.useState('50');
  const [state, setState] = React.useState({ status: '未测试', up: '--', down: '--', check: '--' });
  const [running, setRunning] = React.useState(false);

  function run() {
    setRunning(true);
    setState({ status: '测试中…', up: '--', down: '--', check: '--' });
    onToast(size + ' MB 测速已开始');
    setTimeout(() => {
      setState({ status: '完成', up: '11.4 MB/s', down: '23.8 MB/s', check: '通过' });
      setRunning(false);
      onToast('测速完成');
    }, 1600);
  }

  return (
    <Panel title="pCloud 速度测试">
      <div className="speed-test-controls">
        <Field label="测试大小" style={{ margin: 0 }}>
          <Select value={size} onChange={(e) => setSize(e.target.value)} style={{ width: 150 }}>
            <option value="10">10 MB</option>
            <option value="50">50 MB</option>
            <option value="100">100 MB</option>
          </Select>
        </Field>
        <Button onClick={run} disabled={running}>{running ? '测速中' : '开始测速'}</Button>
      </div>
      <div className="speed-test-result">
        <span>状态：<b>{state.status}</b></span>
        <span>上传速度：<b>{state.up}</b></span>
        <span>下载速度：<b>{state.down}</b></span>
        <span>校验：<b>{state.check}</b></span>
      </div>
      <small style={{ color: 'var(--muted)', fontSize: 12 }}>
        测速会在 pCloud 的 /pcloud-nas-sync-speed-test 目录创建临时文件，测试结束后自动清理；不会进入同步任务。
      </small>
    </Panel>
  );
}

function SettingsScreen({ data, onPick, onToast }) {
  return (
    <>
      <header className="workspace-header"><div><h2>设置</h2><p className="ver">v{data.version}</p></div></header>
      <form className="settings-grid" onSubmit={(e) => e.preventDefault()}>
        <Panel className="task-editor-panel" title="任务配置" action={<Button variant="soft">新增任务</Button>}>
          <div className="task-editors">
            {data.tasks.map((task) => (
              <section className="task-editor" key={task.id}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <Field label="启用" inline><input type="checkbox" defaultChecked={task.enabled} /></Field>
                  <Button variant="soft">删除</Button>
                </div>
                <Field label="任务名称"><Input defaultValue={task.name} /></Field>
                <Field label="本地文件夹">
                  <div className="input-action">
                    <Input defaultValue={task.localPath} />
                    <Button variant="soft" onClick={() => onPick('local')}>选择</Button>
                  </div>
                </Field>
                <Field label="pCloud 文件夹">
                  <div className="input-action">
                    <Input defaultValue={task.remotePath} />
                    <Button variant="soft" onClick={() => onPick('remote')}>选择</Button>
                  </div>
                </Field>
                <Field label="定时方式">
                  <Select defaultValue={task.schedule}><option>{task.schedule}</option><option>手动</option></Select>
                </Field>
              </section>
            ))}
          </div>
        </Panel>

        <Panel title="pCloud 授权">
          <Field label="pCloud 区域">
            <Select><option>US api.pcloud.com</option><option>EU eapi.pcloud.com</option></Select>
          </Field>
          <Field label="pCloud Client ID"><Input defaultValue="•••••••••••" /></Field>
          <Field label="pCloud Client Secret"><Input type="password" defaultValue="secret" /></Field>
          <Field label="授权 Code"><Input placeholder="粘贴一次性授权码" /></Field>
          <div className="row">
            <Button>换取 Token</Button>
            <Button variant="soft">测试连接</Button>
          </div>
          <Field label="Access Token" style={{ marginTop: 13 }}><Input type="password" placeholder="已保存时可留空" /></Field>
        </Panel>

        <Panel title="同步规则">
          <Field label="并发上传数" note="pCloud 官方文档未声明推荐并发；建议 1-4，最高 8。">
            <Input type="number" defaultValue={4} />
          </Field>
          <Field label="文件名冲突时让 pCloud 自动重命名" inline><input type="checkbox" /></Field>
          <Field label="上传后校验" note="默认不做全量校验；校验会调用 pCloud checksumfile。" style={{ marginTop: 13 }}>
            <Select defaultValue="failed"><option value="off">不校验</option><option value="failed">失败后校验</option><option value="sample">抽样校验</option><option value="all">全部校验</option></Select>
          </Field>
          <div className="two">
            <Field label="日志保存天数" note="0 表示不按时间删除。"><Input type="number" defaultValue={30} /></Field>
            <Field label="日志保存条数" note="0 表示不按条数删除。"><Input type="number" defaultValue={2000} /></Field>
          </div>
          <Field label="忽略规则"><Textarea rows={5} defaultValue={'.DS_Store\n*.tmp\nnode_modules/'} /></Field>
        </Panel>

        <SpeedTestPanel onToast={onToast} />

        <Button type="submit" className="save-settings">保存设置</Button>
      </form>
    </>
  );
}

function FolderDialog({ kind, onClose, onToast }) {
  const data = window.KIT_DATA;
  const [path, setPath] = React.useState(kind === 'local' ? '/vol1/1000' : '/Sync');
  const entries = data.folders[path] || ['Finance', 'Photos', 'Work'];
  return (
    <div className="scrim" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3 style={{ fontSize: 16 }}>{kind === 'local' ? '选择本地文件夹' : '选择 pCloud 文件夹'}</h3>
          <Button variant="soft" onClick={onClose}>关闭</Button>
        </header>
        <div className="folder-path">{path}</div>
        <div className="row">
          <Button variant="soft" onClick={() => setPath(path.split('/').slice(0, -1).join('/') || '/')}>上一级</Button>
          <Button onClick={() => { onToast('已选择 ' + path); onClose(); }}>选择当前文件夹</Button>
        </div>
        <ul className="folder-entries">
          {entries.map((name) => (
            <li key={name}>
              <button type="button" onClick={() => setPath((path === '/' ? '' : path) + '/' + name)}>📁 {name}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, TasksScreen, LogsScreen, SettingsScreen, SpeedTestPanel, FolderDialog });
