// pCloud NAS Sync — app shell. Tab state, toast, folder dialog.
function App() {
  const data = window.KIT_DATA;
  const [tab, setTab] = React.useState('tasks');
  const [pick, setPick] = React.useState(null); // 'local' | 'remote' | null
  const [toast, setToast] = React.useState('');
  const toastTimer = React.useRef(null);

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  }

  return (
    <>
      <Sidebar tab={tab} onTab={setTab} onCreate={() => { setTab('settings'); showToast('已新增空白任务'); }} />
      <main className="workspace">
        {tab === 'tasks' && (
          <TasksScreen
            data={data}
            onScan={() => showToast('扫描已触发')}
            onForce={() => showToast('远端重新比对已触发')}
            onStop={() => showToast('正在停止同步')}
            onRetry={() => showToast('3 个已入队，0 个失败')}
            onLogs={() => setTab('logs')}
            onEdit={() => setTab('settings')}
          />
        )}
        {tab === 'logs' && <LogsScreen data={data} />}
        {tab === 'settings' && <SettingsScreen data={data} onPick={setPick} onToast={showToast} />}
      </main>
      {pick && <FolderDialog kind={pick} onClose={() => setPick(null)} onToast={showToast} />}
      <div id="toast" className={toast ? 'show' : ''}>{toast}</div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
