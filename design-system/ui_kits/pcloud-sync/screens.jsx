// pCloud NAS Sync — screens. Composes the design-system component primitives.
const DS = window.PCloudNASSyncDesignSystem_4c073a;
const { Button, NavItem, TaskCard, MetricCard, Panel, StatusPill, Field, Input, Select, Textarea } = DS;

const TABS = [
  { id: 'tasks', label: 'Sync Tasks' },
  { id: 'logs', label: 'Sync Logs' },
  { id: 'settings', label: 'Settings' },
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
          + Create New Task
        </Button>
      </div>
    </aside>
  );
}

function TasksScreen({ data, onScan, onForce, onStop, onRetry, onLogs, onEdit }) {
  const t = data.totals;
  const metrics = [
    { v: t.total.toLocaleString(), l: 'Total files' },
    { v: t.synced, l: 'Uploaded', tone: 'success' },
    { v: t.existing.toLocaleString(), l: 'Existing' },
    { v: t.failed, l: 'Failed', tone: 'danger' },
    { v: t.pending, l: 'Pending upload' },
    { v: t.uploading, l: 'Uploading', tone: 'accent' },
    { v: t.speed, l: 'Upload speed', tone: 'accent' },
  ];
  const queue = [
    { status: 'failed', key: 'work/contracts/lease-final.pdf', error: 'Upload timed out (retried 2 times)' },
    { status: 'pending', key: 'photos/2026/IMG_4822.HEIC', error: '' },
    { status: 'pending', key: 'photos/2026/IMG_4823.HEIC', error: '' },
    { status: 'uploading', key: 'photos/2026/IMG_4821.HEIC', error: '' },
  ];
  return (
    <>
      <header className="workspace-header">
        <div>
          <h2>Sync Tasks</h2>
          <p className="ver">v{data.version}</p>
        </div>
        <div className="actions">
          <Button onClick={onScan}>Scan Now</Button>
          <Button variant="soft" onClick={onForce}>Force Remote Compare</Button>
          <Button variant="soft" onClick={onStop}>Stop Sync</Button>
          <Button variant="soft" onClick={onRetry}>Retry Failed</Button>
        </div>
      </header>

      <p className="metric-scope">All Tasks</p>
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
              <Button variant="soft" onClick={() => onLogs(task)}>View Logs</Button>
              <Button variant="soft" onClick={() => onEdit(task)}>Edit</Button>
            </>}
          />
        ))}
      </section>

      <Panel title="Queue Status">
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ width: 92 }}>Status</th><th>File</th><th>Reason</th></tr></thead>
            <tbody>
              {queue.map((r, i) => (
                <tr key={i}>
                  <td><StatusPill status={r.status}>{{ failed: 'Failed', pending: 'Pending upload', uploading: 'Uploading' }[r.status]}</StatusPill></td>
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
      <header className="workspace-header"><div><h2>Sync Logs</h2><p className="ver">v{data.version}</p></div></header>
      <Panel padding={0} style={{ overflow: 'hidden' }}>
        <div className="log-toolbar">
          <Select defaultValue=""><option value="">All Tasks</option><option>finance</option><option>photos</option><option>work</option></Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All Statuses</option><option value="uploading">Uploading</option><option value="success">Success</option><option value="failed">Failed</option>
          </Select>
          <Input placeholder="Search file name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table className="log-table">
            <thead><tr><th>File Name</th><th>Size</th><th>Task</th><th>Time</th><th>Status</th><th>Progress</th></tr></thead>
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
              {rows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No file sync logs yet</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function SpeedTestPanel({ onToast }) {
  const [size, setSize] = React.useState('50');
  const [state, setState] = React.useState({ status: 'Not tested', up: '--', down: '--', check: '--' });
  const [running, setRunning] = React.useState(false);

  function run() {
    setRunning(true);
    setState({ status: 'Testing...', up: '--', down: '--', check: '--' });
    onToast(size + ' MB speed test started');
    setTimeout(() => {
      setState({ status: 'Complete', up: '11.4 MB/s', down: '23.8 MB/s', check: 'Passed' });
      setRunning(false);
      onToast('Speed test complete');
    }, 1600);
  }

  return (
    <Panel title="pCloud Speed Test">
      <div className="speed-test-controls">
        <Field label="Test size" style={{ margin: 0 }}>
          <Select value={size} onChange={(e) => setSize(e.target.value)} style={{ width: 150 }}>
            <option value="10">10 MB</option>
            <option value="50">50 MB</option>
            <option value="100">100 MB</option>
          </Select>
        </Field>
        <Button onClick={run} disabled={running}>{running ? 'Testing' : 'Start Test'}</Button>
      </div>
      <div className="speed-test-result">
        <span>Status：<b>{state.status}</b></span>
        <span>Upload speed：<b>{state.up}</b></span>
        <span>Download speed:<b>{state.down}</b></span>
        <span>Verification:<b>{state.check}</b></span>
      </div>
      <small style={{ color: 'var(--muted)', fontSize: 12 }}>
        The speed test creates a temporary file in /pcloud-nas-sync-speed-test on pCloud and removes it after the test; it is not part of any sync task.
      </small>
    </Panel>
  );
}

function SettingsScreen({ data, onPick, onToast }) {
  return (
    <>
      <header className="workspace-header"><div><h2>Settings</h2><p className="ver">v{data.version}</p></div></header>
      <form className="settings-grid" onSubmit={(e) => e.preventDefault()}>
        <Panel className="task-editor-panel" title="Task Configuration" action={<Button variant="soft">Add Task</Button>}>
          <div className="task-editors">
            {data.tasks.map((task) => (
              <section className="task-editor" key={task.id}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <Field label="Enabled" inline><input type="checkbox" defaultChecked={task.enabled} /></Field>
                  <Button variant="soft">Delete</Button>
                </div>
                <Field label="Task name"><Input defaultValue={task.name} /></Field>
                <Field label="Local Folder">
                  <div className="input-action">
                    <Input defaultValue={task.localPath} />
                    <Button variant="soft" onClick={() => onPick('local')}>Choose</Button>
                  </div>
                </Field>
                <Field label="pCloud Folder">
                  <div className="input-action">
                    <Input defaultValue={task.remotePath} />
                    <Button variant="soft" onClick={() => onPick('remote')}>Choose</Button>
                  </div>
                </Field>
                <Field label="Schedule Type">
                  <Select defaultValue={task.schedule}><option>{task.schedule}</option><option>Manual</option></Select>
                </Field>
              </section>
            ))}
          </div>
        </Panel>

        <Panel title="pCloud Authorization">
          <Field label="pCloud Region">
            <Select><option>US api.pcloud.com</option><option>EU eapi.pcloud.com</option></Select>
          </Field>
          <Field label="pCloud Client ID"><Input defaultValue="•••••••••••" /></Field>
          <Field label="pCloud Client Secret"><Input type="password" defaultValue="secret" /></Field>
          <Field label="Authorization Code"><Input placeholder="Paste one-time authorization code" /></Field>
          <div className="row">
            <Button>Exchange Token</Button>
            <Button variant="soft">Test Connection</Button>
          </div>
          <Field label="Access Token" style={{ marginTop: 13 }}><Input type="password" placeholder="Leave blank if already saved" /></Field>
        </Panel>

        <Panel title="Sync Rules">
          <Field label="Concurrent uploads" note="pCloud docs do not publish a recommended concurrency; use 1-4, max 8.">
            <Input type="number" defaultValue={4} />
          </Field>
          <Field label="Let pCloud rename filename conflicts automatically" inline><input type="checkbox" /></Field>
          <Field label="Post-upload verification" note="Full verification is off by default; verification calls pCloud checksumfile." style={{ marginTop: 13 }}>
            <Select defaultValue="failed"><option value="off">Off</option><option value="failed">Verify failed uploads</option><option value="sample">Sample verification</option><option value="all">Verify all uploads</option></Select>
          </Field>
          <div className="two">
            <Field label="Log retention days" note="0 disables age-based deletion."><Input type="number" defaultValue={30} /></Field>
            <Field label="Log retention count" note="0 disables count-based deletion."><Input type="number" defaultValue={2000} /></Field>
          </div>
          <Field label="Ignore patterns"><Textarea rows={5} defaultValue={'.DS_Store\n*.tmp\nnode_modules/'} /></Field>
        </Panel>

        <SpeedTestPanel onToast={onToast} />

        <Button type="submit" className="save-settings">Save Settings</Button>
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
          <h3 style={{ fontSize: 16 }}>{kind === 'local' ? 'Choose Local Folder' : 'Choose pCloud Folder'}</h3>
          <Button variant="soft" onClick={onClose}>Close</Button>
        </header>
        <div className="folder-path">{path}</div>
        <div className="row">
          <Button variant="soft" onClick={() => setPath(path.split('/').slice(0, -1).join('/') || '/')}>Up One Level</Button>
          <Button onClick={() => { onToast('Selected ' + path); onClose(); }}>Select Current Folder</Button>
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
