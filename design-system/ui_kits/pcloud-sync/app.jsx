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
      <Sidebar tab={tab} onTab={setTab} onCreate={() => { setTab('settings'); showToast('Added a blank task'); }} />
      <main className="workspace">
        {tab === 'tasks' && (
          <TasksScreen
            data={data}
            onScan={() => showToast('Scan started')}
            onForce={() => showToast('Remote comparison started')}
            onStop={() => showToast('Stopping sync')}
            onRetry={() => showToast('3 queued, 0 failed')}
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
