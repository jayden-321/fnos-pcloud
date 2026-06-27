/* @ds-bundle: {"format":3,"namespace":"PCloudNASSyncDesignSystem_4c073a","components":[{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Field","sourcePath":"components/core/Field.jsx"},{"name":"Input","sourcePath":"components/core/Field.jsx"},{"name":"Select","sourcePath":"components/core/Field.jsx"},{"name":"Textarea","sourcePath":"components/core/Field.jsx"},{"name":"MetricCard","sourcePath":"components/core/MetricCard.jsx"},{"name":"Panel","sourcePath":"components/core/Panel.jsx"},{"name":"StatusPill","sourcePath":"components/core/StatusPill.jsx"},{"name":"NavItem","sourcePath":"components/navigation/NavItem.jsx"},{"name":"TaskCard","sourcePath":"components/tasks/TaskCard.jsx"}],"sourceHashes":{"components/core/Button.jsx":"d43f305bcfdd","components/core/Field.jsx":"c9a0886c43c0","components/core/MetricCard.jsx":"6a3e073f3459","components/core/Panel.jsx":"0a91798dadb8","components/core/StatusPill.jsx":"e88564d9bddc","components/navigation/NavItem.jsx":"9a00f9c71d61","components/tasks/TaskCard.jsx":"628a1f13f572","ui_kits/pcloud-sync/app.jsx":"901c9414526f","ui_kits/pcloud-sync/data.js":"851bd38641d4","ui_kits/pcloud-sync/screens.jsx":"a5d5fbe0e43e"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.PCloudNASSyncDesignSystem_4c073a = window.PCloudNASSyncDesignSystem_4c073a || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — the product's action control. Primary is solid accent-blue; "soft"
 * is the pale-blue secondary used on cards, dialogs and task editors; "ghost"
 * is the transparent sidebar/link style.
 */
function Button({
  children,
  variant = 'primary',
  type = 'button',
  disabled = false,
  fullWidth = false,
  style = {},
  ...rest
}) {
  const base = {
    minHeight: 'var(--control-h, 36px)',
    border: 0,
    borderRadius: 'var(--radius-sm, 6px)',
    padding: '0 var(--btn-pad-x, 14px)',
    font: 'inherit',
    fontWeight: 'var(--fw-bold, 700)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.48 : 1,
    width: fullWidth ? '100%' : undefined,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'background 120ms ease'
  };
  const variants = {
    primary: {
      background: 'var(--accent)',
      color: '#fff'
    },
    soft: {
      background: 'var(--accent-soft)',
      color: 'var(--accent-ink)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text)'
    },
    link: {
      background: 'transparent',
      color: 'var(--create-ink)'
    }
  };
  const [hover, setHover] = React.useState(false);
  const hoverBg = {
    primary: 'var(--accent-strong)',
    soft: 'var(--accent-soft-hover)',
    ghost: 'var(--nav-hover)',
    link: 'var(--nav-hover)'
  };
  const merged = {
    ...base,
    ...variants[variant],
    ...(hover && !disabled ? {
      background: hoverBg[variant]
    } : null),
    ...style
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    style: merged,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false)
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Field.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Field — label-over-control form group, the product's only form pattern.
 * Renders a 650-weight label, the control, and an optional muted field note.
 */
function Field({
  label,
  note,
  children,
  inline = false,
  style = {}
}) {
  if (inline) {
    return /*#__PURE__*/React.createElement("label", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: 0,
        color: 'var(--text-soft)',
        fontWeight: 650,
        ...style
      }
    }, children, label);
  }
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'grid',
      gap: 6,
      margin: '0 0 13px',
      color: 'var(--text-soft)',
      fontWeight: 650,
      ...style
    }
  }, label, children, note && /*#__PURE__*/React.createElement("small", {
    style: {
      color: 'var(--muted)',
      fontSize: 12,
      fontWeight: 500
    }
  }, note));
}
const controlStyle = {
  width: '100%',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm, 6px)',
  padding: '9px 10px',
  color: 'var(--text)',
  background: '#fff',
  font: 'inherit'
};
function Input(props) {
  return /*#__PURE__*/React.createElement("input", _extends({}, props, {
    style: {
      ...controlStyle,
      ...(props.style || {})
    }
  }));
}
function Select({
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("select", _extends({}, props, {
    style: {
      ...controlStyle,
      ...(props.style || {})
    }
  }), children);
}
function Textarea(props) {
  return /*#__PURE__*/React.createElement("textarea", _extends({}, props, {
    style: {
      ...controlStyle,
      resize: 'vertical',
      ...(props.style || {})
    }
  }));
}
Object.assign(__ds_scope, { Field, Input, Select, Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Field.jsx", error: String((e && e.message) || e) }); }

// components/core/MetricCard.jsx
try { (() => {
/**
 * MetricCard — a single dashboard statistic tile (大数字 + small label),
 * exactly as used in the sync-tasks metrics strip.
 */
function MetricCard({
  value,
  label,
  tone = 'default',
  style = {}
}) {
  const tones = {
    default: 'var(--text)',
    success: 'var(--green)',
    danger: 'var(--danger)',
    accent: 'var(--accent)',
    muted: 'var(--queued)'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius-md, 8px)',
      padding: 16,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontSize: 26,
      fontWeight: 760,
      lineHeight: 1.1,
      color: tones[tone]
    }
  }, value), /*#__PURE__*/React.createElement("small", {
    style: {
      color: 'var(--muted)',
      fontSize: 13
    }
  }, label));
}
Object.assign(__ds_scope, { MetricCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/MetricCard.jsx", error: String((e && e.message) || e) }); }

// components/core/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Panel — the white bordered container that wraps every section in the product
 * (queue table, settings groups, dialogs). Flat: fill + 1px line, no shadow.
 */
function Panel({
  title,
  action,
  children,
  padding = 18,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("section", _extends({
    style: {
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius-md, 8px)',
      padding,
      ...style
    }
  }, rest), (title || action) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: action ? 'space-between' : 'flex-start',
      marginBottom: 16
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 16,
      fontWeight: 'var(--fw-bold,700)',
      color: 'var(--text)'
    }
  }, title), action), children);
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Panel.jsx", error: String((e && e.message) || e) }); }

// components/core/StatusPill.jsx
try { (() => {
/**
 * StatusPill — colored status text used in logs, queue rows and task cards.
 * It is weight-700 colored text (not a filled badge) per the product style.
 */
const STATUS = {
  success: {
    color: 'var(--green)',
    label: '成功'
  },
  failed: {
    color: 'var(--danger)',
    label: '失败'
  },
  uploading: {
    color: 'var(--accent)',
    label: '上传中'
  },
  queued: {
    color: 'var(--queued)',
    label: '待处理'
  },
  existing: {
    color: 'var(--muted)',
    label: '已存在'
  }
};
function StatusPill({
  status = 'queued',
  children,
  style = {}
}) {
  const s = STATUS[status] || STATUS.queued;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: s.color,
      ...style
    }
  }, children ?? s.label);
}
Object.assign(__ds_scope, { StatusPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatusPill.jsx", error: String((e && e.message) || e) }); }

// components/navigation/NavItem.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * NavItem — a left-rail navigation button. Active = solid accent fill on white
 * text; idle = transparent with a soft-blue hover.
 */
function NavItem({
  children,
  active = false,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start',
      width: '100%',
      minHeight: 40,
      border: 0,
      borderRadius: 'var(--radius-sm, 6px)',
      padding: '0 14px',
      fontSize: 16,
      fontWeight: 'var(--fw-bold, 700)',
      cursor: 'pointer',
      textAlign: 'left',
      background: active ? 'var(--accent)' : hover ? 'var(--nav-hover)' : 'transparent',
      color: active ? '#fff' : 'var(--text)',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { NavItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/NavItem.jsx", error: String((e && e.message) || e) }); }

// components/tasks/TaskCard.jsx
try { (() => {
/**
 * TaskCard — a single sync-task row on the Sync Tasks page. Shows the task
 * name, a colored status line, optional scan-source detail, an inline stat
 * grid, and right-aligned actions.
 */
function TaskCard({
  name,
  status = 'queued',
  statusLabel,
  scanMode,
  scanDetail,
  stats = {},
  actions
}) {
  const items = [['总', stats.total], ['已存在', stats.existing], ['已成功', stats.synced], ['待上传', stats.pending], ['失败', stats.failed]].filter(([, v]) => v !== undefined && v !== null);
  return /*#__PURE__*/React.createElement("article", {
    style: {
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius-md, 8px)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 14,
      padding: '22px 28px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 20,
      fontWeight: 700,
      color: 'var(--text)'
    }
  }, name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.StatusPill, {
    status: status
  }, statusLabel)), scanMode && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: 13,
      color: 'var(--muted)'
    }
  }, "\u626B\u63CF\u4F9D\u636E\uFF1A", scanMode), scanDetail && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: 13,
      color: 'var(--muted)'
    }
  }, scanDetail), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px 14px',
      marginTop: 10,
      color: 'var(--muted)',
      fontSize: 13
    }
  }, items.map(([label, value]) => /*#__PURE__*/React.createElement("span", {
    key: label
  }, label, " ", value)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      gap: 10
    }
  }, actions ?? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "soft"
  }, "\u67E5\u770B\u65E5\u5FD7"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "soft"
  }, "\u7F16\u8F91")))));
}
Object.assign(__ds_scope, { TaskCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/tasks/TaskCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/pcloud-sync/app.jsx
try { (() => {
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
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Sidebar, {
    tab: tab,
    onTab: setTab,
    onCreate: () => {
      setTab('settings');
      showToast('已新增空白任务');
    }
  }), /*#__PURE__*/React.createElement("main", {
    className: "workspace"
  }, tab === 'tasks' && /*#__PURE__*/React.createElement(TasksScreen, {
    data: data,
    onScan: () => showToast('扫描已触发'),
    onForce: () => showToast('远端重新比对已触发'),
    onStop: () => showToast('正在停止同步'),
    onRetry: () => showToast('3 个已入队，0 个失败'),
    onLogs: () => setTab('logs'),
    onEdit: () => setTab('settings')
  }), tab === 'logs' && /*#__PURE__*/React.createElement(LogsScreen, {
    data: data
  }), tab === 'settings' && /*#__PURE__*/React.createElement(SettingsScreen, {
    data: data,
    onPick: setPick,
    onToast: showToast
  })), pick && /*#__PURE__*/React.createElement(FolderDialog, {
    kind: pick,
    onClose: () => setPick(null),
    onToast: showToast
  }), /*#__PURE__*/React.createElement("div", {
    id: "toast",
    className: toast ? 'show' : ''
  }, toast));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/pcloud-sync/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/pcloud-sync/data.js
try { (() => {
// Fake but realistic data for the pCloud NAS Sync UI kit.
window.KIT_DATA = {
  version: '0.3.7',
  tasks: [{
    id: 't1',
    name: '财务备份',
    enabled: true,
    localPath: '/vol1/1000/finance',
    remotePath: '/Sync/Finance',
    schedule: '每天 02:00',
    status: 'success',
    statusLabel: '同步完成',
    scanMode: '远端增量',
    scanDetail: '本地 1,284 · 远端 1,266 · 本地扫描 0.4s · 远端增量 0.2s',
    stats: {
      total: 1284,
      existing: 1266,
      synced: 18,
      pending: 0,
      failed: 0
    }
  }, {
    id: 't2',
    name: '照片归档',
    enabled: true,
    localPath: '/vol1/1000/photos',
    remotePath: '/Sync/Photos',
    schedule: '按间隔 300s',
    status: 'uploading',
    statusLabel: '同步中',
    scanMode: '远端全量比对',
    scanDetail: '本地 8,420 · 远端 8,100 · 本地扫描 1.8s · 远端列举 6.4s',
    stats: {
      total: 8420,
      existing: 8100,
      synced: 96,
      pending: 224,
      failed: 0
    }
  }, {
    id: 't3',
    name: '工作文档',
    enabled: true,
    localPath: '/vol1/1000/work',
    remotePath: '/Sync/Work',
    schedule: '每周 一 09:00',
    status: 'failed',
    statusLabel: '同步中',
    scanMode: '本地缓存',
    scanDetail: '本地 542 · 时间不同 3',
    stats: {
      total: 542,
      existing: 528,
      synced: 8,
      pending: 3,
      failed: 3
    }
  }],
  logs: [{
    file: 'finance/2026/Q1-report.xlsx',
    size: '4.2 MB',
    task: 'finance',
    time: '2026-06-27 02:00:14',
    status: 'success',
    statusText: '成功',
    progress: ''
  }, {
    file: 'photos/2026/IMG_4821.HEIC',
    size: '3.1 MB',
    task: 'photos',
    time: '2026-06-27 02:14:03',
    status: 'uploading',
    statusText: '上传中',
    progress: '1.9 MB / 3.1 MB (61%)'
  }, {
    file: 'photos/2026/IMG_4820.HEIC',
    size: '2.8 MB',
    task: 'photos',
    time: '2026-06-27 02:13:58',
    status: 'success',
    statusText: '成功',
    progress: ''
  }, {
    file: 'work/contracts/lease-final.pdf',
    size: '880 KB',
    task: 'work',
    time: '2026-06-27 02:01:22',
    status: 'failed',
    statusText: '失败',
    progress: ''
  }, {
    file: 'finance/2026/invoices-jan.zip',
    size: '12.4 MB',
    task: 'finance',
    time: '2026-06-27 02:00:09',
    status: 'success',
    statusText: '成功',
    progress: ''
  }, {
    file: 'work/notes/standup.md',
    size: '6 KB',
    task: 'work',
    time: '2026-06-27 02:01:05',
    status: 'success',
    statusText: '成功',
    progress: ''
  }, {
    file: 'photos/2026/IMG_4815.HEIC',
    size: '3.4 MB',
    task: 'photos',
    time: '2026-06-27 02:12:40',
    status: 'success',
    statusText: '成功',
    progress: ''
  }],
  totals: {
    total: 10246,
    synced: 122,
    existing: 9894,
    failed: 3,
    pending: 227,
    uploading: 1,
    speed: '1.2 MB/s'
  },
  folders: {
    '/': ['vol1', 'vol2'],
    '/vol1': ['1000', 'docker'],
    '/vol1/1000': ['finance', 'photos', 'work', 'media']
  }
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/pcloud-sync/data.js", error: String((e && e.message) || e) }); }

// ui_kits/pcloud-sync/screens.jsx
try { (() => {
// pCloud NAS Sync — screens. Composes the design-system component primitives.
const DS = window.PCloudNASSyncDesignSystem_4c073a;
const {
  Button,
  NavItem,
  TaskCard,
  MetricCard,
  Panel,
  StatusPill,
  Field,
  Input,
  Select,
  Textarea
} = DS;
const TABS = [{
  id: 'tasks',
  label: '同步任务'
}, {
  id: 'logs',
  label: '同步日志'
}, {
  id: 'settings',
  label: '设置'
}];
function Sidebar({
  tab,
  onTab,
  onCreate
}) {
  return /*#__PURE__*/React.createElement("aside", {
    className: "sidebar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sidebar-brand"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/app-icon-256.png",
    alt: ""
  }), /*#__PURE__*/React.createElement("b", null, "pCloud NAS Sync")), /*#__PURE__*/React.createElement("nav", null, TABS.map(t => /*#__PURE__*/React.createElement(NavItem, {
    key: t.id,
    active: tab === t.id,
    onClick: () => onTab(t.id)
  }, t.label))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'auto'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "link",
    fullWidth: true,
    style: {
      justifyContent: 'flex-start'
    },
    onClick: onCreate
  }, "\uFF0B \u521B\u5EFA\u65B0\u4EFB\u52A1")));
}
function TasksScreen({
  data,
  onScan,
  onForce,
  onStop,
  onRetry,
  onLogs,
  onEdit
}) {
  const t = data.totals;
  const metrics = [{
    v: t.total.toLocaleString(),
    l: '总文件'
  }, {
    v: t.synced,
    l: '已成功',
    tone: 'success'
  }, {
    v: t.existing.toLocaleString(),
    l: '已存在'
  }, {
    v: t.failed,
    l: '失败',
    tone: 'danger'
  }, {
    v: t.pending,
    l: '待上传'
  }, {
    v: t.uploading,
    l: '上传中',
    tone: 'accent'
  }, {
    v: t.speed,
    l: '上传速度',
    tone: 'accent'
  }];
  const queue = [{
    status: 'failed',
    key: 'work/contracts/lease-final.pdf',
    error: '上传超时（已重试 2 次）'
  }, {
    status: 'pending',
    key: 'photos/2026/IMG_4822.HEIC',
    error: ''
  }, {
    status: 'pending',
    key: 'photos/2026/IMG_4823.HEIC',
    error: ''
  }, {
    status: 'uploading',
    key: 'photos/2026/IMG_4821.HEIC',
    error: ''
  }];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("header", {
    className: "workspace-header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", null, "\u540C\u6B65\u4EFB\u52A1"), /*#__PURE__*/React.createElement("p", {
    className: "ver"
  }, "v", data.version)), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, /*#__PURE__*/React.createElement(Button, {
    onClick: onScan
  }, "\u7ACB\u5373\u626B\u63CF"), /*#__PURE__*/React.createElement(Button, {
    variant: "soft",
    onClick: onForce
  }, "\u8FDC\u7AEF\u91CD\u65B0\u6BD4\u5BF9"), /*#__PURE__*/React.createElement(Button, {
    variant: "soft",
    onClick: onStop
  }, "\u505C\u6B62\u540C\u6B65"), /*#__PURE__*/React.createElement(Button, {
    variant: "soft",
    onClick: onRetry
  }, "\u91CD\u8BD5\u5931\u8D25"))), /*#__PURE__*/React.createElement("p", {
    className: "metric-scope"
  }, "\u5168\u90E8\u4EFB\u52A1"), /*#__PURE__*/React.createElement("section", {
    className: "metrics"
  }, metrics.map(m => /*#__PURE__*/React.createElement(MetricCard, {
    key: m.l,
    value: m.v,
    label: m.l,
    tone: m.tone
  }))), /*#__PURE__*/React.createElement("section", {
    className: "task-list"
  }, data.tasks.map(task => /*#__PURE__*/React.createElement(TaskCard, {
    key: task.id,
    name: task.name,
    status: task.status,
    statusLabel: task.statusLabel,
    scanMode: task.scanMode,
    scanDetail: task.scanDetail,
    stats: task.stats,
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "soft",
      onClick: () => onLogs(task)
    }, "\u67E5\u770B\u65E5\u5FD7"), /*#__PURE__*/React.createElement(Button, {
      variant: "soft",
      onClick: () => onEdit(task)
    }, "\u7F16\u8F91"))
  }))), /*#__PURE__*/React.createElement(Panel, {
    title: "\u961F\u5217\u72B6\u6001"
  }, /*#__PURE__*/React.createElement("div", {
    className: "table-wrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      width: 92
    }
  }, "\u72B6\u6001"), /*#__PURE__*/React.createElement("th", null, "\u6587\u4EF6"), /*#__PURE__*/React.createElement("th", null, "\u539F\u56E0"))), /*#__PURE__*/React.createElement("tbody", null, queue.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(StatusPill, {
    status: r.status
  }, {
    failed: '失败',
    pending: '待上传',
    uploading: '上传中'
  }[r.status])), /*#__PURE__*/React.createElement("td", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 13
    }
  }, r.key), /*#__PURE__*/React.createElement("td", {
    style: {
      color: 'var(--muted)'
    }
  }, r.error))))))));
}
function LogsScreen({
  data
}) {
  const [status, setStatus] = React.useState('');
  const [search, setSearch] = React.useState('');
  const rows = data.logs.filter(r => !status || r.status === status).filter(r => !search || r.file.toLowerCase().includes(search.toLowerCase()));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("header", {
    className: "workspace-header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", null, "\u540C\u6B65\u65E5\u5FD7"), /*#__PURE__*/React.createElement("p", {
    className: "ver"
  }, "v", data.version))), /*#__PURE__*/React.createElement(Panel, {
    padding: 0,
    style: {
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "log-toolbar"
  }, /*#__PURE__*/React.createElement(Select, {
    defaultValue: ""
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u5168\u90E8\u4EFB\u52A1"), /*#__PURE__*/React.createElement("option", null, "finance"), /*#__PURE__*/React.createElement("option", null, "photos"), /*#__PURE__*/React.createElement("option", null, "work")), /*#__PURE__*/React.createElement(Select, {
    value: status,
    onChange: e => setStatus(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u5168\u90E8\u72B6\u6001"), /*#__PURE__*/React.createElement("option", {
    value: "uploading"
  }, "\u4E0A\u4F20\u4E2D"), /*#__PURE__*/React.createElement("option", {
    value: "success"
  }, "\u6210\u529F"), /*#__PURE__*/React.createElement("option", {
    value: "failed"
  }, "\u5931\u8D25")), /*#__PURE__*/React.createElement(Input, {
    placeholder: "\u641C\u7D22\u6587\u4EF6\u540D\u79F0",
    value: search,
    onChange: e => setSearch(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "table-wrap"
  }, /*#__PURE__*/React.createElement("table", {
    className: "log-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "\u6587\u4EF6\u540D\u79F0"), /*#__PURE__*/React.createElement("th", null, "\u5927\u5C0F"), /*#__PURE__*/React.createElement("th", null, "\u4EFB\u52A1"), /*#__PURE__*/React.createElement("th", null, "\u65F6\u95F4"), /*#__PURE__*/React.createElement("th", null, "\u72B6\u6001"), /*#__PURE__*/React.createElement("th", null, "\u8FDB\u5EA6"))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 13
    }
  }, r.file), /*#__PURE__*/React.createElement("td", null, r.size), /*#__PURE__*/React.createElement("td", null, r.task), /*#__PURE__*/React.createElement("td", null, r.time), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(StatusPill, {
    status: r.status
  }, r.statusText)), /*#__PURE__*/React.createElement("td", null, r.progress))), rows.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 6,
    style: {
      color: 'var(--muted)'
    }
  }, "\u6682\u65E0\u6587\u4EF6\u540C\u6B65\u65E5\u5FD7")))))));
}
function SpeedTestPanel({
  onToast
}) {
  const [size, setSize] = React.useState('50');
  const [state, setState] = React.useState({
    status: '未测试',
    up: '--',
    down: '--',
    check: '--'
  });
  const [running, setRunning] = React.useState(false);
  function run() {
    setRunning(true);
    setState({
      status: '测试中…',
      up: '--',
      down: '--',
      check: '--'
    });
    onToast(size + ' MB 测速已开始');
    setTimeout(() => {
      setState({
        status: '完成',
        up: '11.4 MB/s',
        down: '23.8 MB/s',
        check: '通过'
      });
      setRunning(false);
      onToast('测速完成');
    }, 1600);
  }
  return /*#__PURE__*/React.createElement(Panel, {
    title: "pCloud \u901F\u5EA6\u6D4B\u8BD5"
  }, /*#__PURE__*/React.createElement("div", {
    className: "speed-test-controls"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "\u6D4B\u8BD5\u5927\u5C0F",
    style: {
      margin: 0
    }
  }, /*#__PURE__*/React.createElement(Select, {
    value: size,
    onChange: e => setSize(e.target.value),
    style: {
      width: 150
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "10"
  }, "10 MB"), /*#__PURE__*/React.createElement("option", {
    value: "50"
  }, "50 MB"), /*#__PURE__*/React.createElement("option", {
    value: "100"
  }, "100 MB"))), /*#__PURE__*/React.createElement(Button, {
    onClick: run,
    disabled: running
  }, running ? '测速中' : '开始测速')), /*#__PURE__*/React.createElement("div", {
    className: "speed-test-result"
  }, /*#__PURE__*/React.createElement("span", null, "\u72B6\u6001\uFF1A", /*#__PURE__*/React.createElement("b", null, state.status)), /*#__PURE__*/React.createElement("span", null, "\u4E0A\u4F20\u901F\u5EA6\uFF1A", /*#__PURE__*/React.createElement("b", null, state.up)), /*#__PURE__*/React.createElement("span", null, "\u4E0B\u8F7D\u901F\u5EA6\uFF1A", /*#__PURE__*/React.createElement("b", null, state.down)), /*#__PURE__*/React.createElement("span", null, "\u6821\u9A8C\uFF1A", /*#__PURE__*/React.createElement("b", null, state.check))), /*#__PURE__*/React.createElement("small", {
    style: {
      color: 'var(--muted)',
      fontSize: 12
    }
  }, "\u6D4B\u901F\u4F1A\u5728 pCloud \u7684 /pcloud-nas-sync-speed-test \u76EE\u5F55\u521B\u5EFA\u4E34\u65F6\u6587\u4EF6\uFF0C\u6D4B\u8BD5\u7ED3\u675F\u540E\u81EA\u52A8\u6E05\u7406\uFF1B\u4E0D\u4F1A\u8FDB\u5165\u540C\u6B65\u4EFB\u52A1\u3002"));
}
function SettingsScreen({
  data,
  onPick,
  onToast
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("header", {
    className: "workspace-header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", null, "\u8BBE\u7F6E"), /*#__PURE__*/React.createElement("p", {
    className: "ver"
  }, "v", data.version))), /*#__PURE__*/React.createElement("form", {
    className: "settings-grid",
    onSubmit: e => e.preventDefault()
  }, /*#__PURE__*/React.createElement(Panel, {
    className: "task-editor-panel",
    title: "\u4EFB\u52A1\u914D\u7F6E",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "soft"
    }, "\u65B0\u589E\u4EFB\u52A1")
  }, /*#__PURE__*/React.createElement("div", {
    className: "task-editors"
  }, data.tasks.map(task => /*#__PURE__*/React.createElement("section", {
    className: "task-editor",
    key: task.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "\u542F\u7528",
    inline: true
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    defaultChecked: task.enabled
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "soft"
  }, "\u5220\u9664")), /*#__PURE__*/React.createElement(Field, {
    label: "\u4EFB\u52A1\u540D\u79F0"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: task.name
  })), /*#__PURE__*/React.createElement(Field, {
    label: "\u672C\u5730\u6587\u4EF6\u5939"
  }, /*#__PURE__*/React.createElement("div", {
    className: "input-action"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: task.localPath
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "soft",
    onClick: () => onPick('local')
  }, "\u9009\u62E9"))), /*#__PURE__*/React.createElement(Field, {
    label: "pCloud \u6587\u4EF6\u5939"
  }, /*#__PURE__*/React.createElement("div", {
    className: "input-action"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: task.remotePath
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "soft",
    onClick: () => onPick('remote')
  }, "\u9009\u62E9"))), /*#__PURE__*/React.createElement(Field, {
    label: "\u5B9A\u65F6\u65B9\u5F0F"
  }, /*#__PURE__*/React.createElement(Select, {
    defaultValue: task.schedule
  }, /*#__PURE__*/React.createElement("option", null, task.schedule), /*#__PURE__*/React.createElement("option", null, "\u624B\u52A8"))))))), /*#__PURE__*/React.createElement(Panel, {
    title: "pCloud \u6388\u6743"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "pCloud \u533A\u57DF"
  }, /*#__PURE__*/React.createElement(Select, null, /*#__PURE__*/React.createElement("option", null, "US api.pcloud.com"), /*#__PURE__*/React.createElement("option", null, "EU eapi.pcloud.com"))), /*#__PURE__*/React.createElement(Field, {
    label: "pCloud Client ID"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "pCloud Client Secret"
  }, /*#__PURE__*/React.createElement(Input, {
    type: "password",
    defaultValue: "secret"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "\u6388\u6743 Code"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "\u7C98\u8D34\u4E00\u6B21\u6027\u6388\u6743\u7801"
  })), /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement(Button, null, "\u6362\u53D6 Token"), /*#__PURE__*/React.createElement(Button, {
    variant: "soft"
  }, "\u6D4B\u8BD5\u8FDE\u63A5")), /*#__PURE__*/React.createElement(Field, {
    label: "Access Token",
    style: {
      marginTop: 13
    }
  }, /*#__PURE__*/React.createElement(Input, {
    type: "password",
    placeholder: "\u5DF2\u4FDD\u5B58\u65F6\u53EF\u7559\u7A7A"
  }))), /*#__PURE__*/React.createElement(Panel, {
    title: "\u540C\u6B65\u89C4\u5219"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "\u5E76\u53D1\u4E0A\u4F20\u6570",
    note: "pCloud \u5B98\u65B9\u6587\u6863\u672A\u58F0\u660E\u63A8\u8350\u5E76\u53D1\uFF1B\u5EFA\u8BAE 1-4\uFF0C\u6700\u9AD8 8\u3002"
  }, /*#__PURE__*/React.createElement(Input, {
    type: "number",
    defaultValue: 4
  })), /*#__PURE__*/React.createElement(Field, {
    label: "\u6587\u4EF6\u540D\u51B2\u7A81\u65F6\u8BA9 pCloud \u81EA\u52A8\u91CD\u547D\u540D",
    inline: true
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "\u4E0A\u4F20\u540E\u6821\u9A8C",
    note: "\u9ED8\u8BA4\u4E0D\u505A\u5168\u91CF\u6821\u9A8C\uFF1B\u6821\u9A8C\u4F1A\u8C03\u7528 pCloud checksumfile\u3002",
    style: {
      marginTop: 13
    }
  }, /*#__PURE__*/React.createElement(Select, {
    defaultValue: "failed"
  }, /*#__PURE__*/React.createElement("option", {
    value: "off"
  }, "\u4E0D\u6821\u9A8C"), /*#__PURE__*/React.createElement("option", {
    value: "failed"
  }, "\u5931\u8D25\u540E\u6821\u9A8C"), /*#__PURE__*/React.createElement("option", {
    value: "sample"
  }, "\u62BD\u6837\u6821\u9A8C"), /*#__PURE__*/React.createElement("option", {
    value: "all"
  }, "\u5168\u90E8\u6821\u9A8C"))), /*#__PURE__*/React.createElement("div", {
    className: "two"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "\u65E5\u5FD7\u4FDD\u5B58\u5929\u6570",
    note: "0 \u8868\u793A\u4E0D\u6309\u65F6\u95F4\u5220\u9664\u3002"
  }, /*#__PURE__*/React.createElement(Input, {
    type: "number",
    defaultValue: 30
  })), /*#__PURE__*/React.createElement(Field, {
    label: "\u65E5\u5FD7\u4FDD\u5B58\u6761\u6570",
    note: "0 \u8868\u793A\u4E0D\u6309\u6761\u6570\u5220\u9664\u3002"
  }, /*#__PURE__*/React.createElement(Input, {
    type: "number",
    defaultValue: 2000
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "\u5FFD\u7565\u89C4\u5219"
  }, /*#__PURE__*/React.createElement(Textarea, {
    rows: 5,
    defaultValue: '.DS_Store\n*.tmp\nnode_modules/'
  }))), /*#__PURE__*/React.createElement(SpeedTestPanel, {
    onToast: onToast
  }), /*#__PURE__*/React.createElement(Button, {
    type: "submit",
    className: "save-settings"
  }, "\u4FDD\u5B58\u8BBE\u7F6E")));
}
function FolderDialog({
  kind,
  onClose,
  onToast
}) {
  const data = window.KIT_DATA;
  const [path, setPath] = React.useState(kind === 'local' ? '/vol1/1000' : '/Sync');
  const entries = data.folders[path] || ['Finance', 'Photos', 'Work'];
  return /*#__PURE__*/React.createElement("div", {
    className: "scrim",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("header", null, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 16
    }
  }, kind === 'local' ? '选择本地文件夹' : '选择 pCloud 文件夹'), /*#__PURE__*/React.createElement(Button, {
    variant: "soft",
    onClick: onClose
  }, "\u5173\u95ED")), /*#__PURE__*/React.createElement("div", {
    className: "folder-path"
  }, path), /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "soft",
    onClick: () => setPath(path.split('/').slice(0, -1).join('/') || '/')
  }, "\u4E0A\u4E00\u7EA7"), /*#__PURE__*/React.createElement(Button, {
    onClick: () => {
      onToast('已选择 ' + path);
      onClose();
    }
  }, "\u9009\u62E9\u5F53\u524D\u6587\u4EF6\u5939")), /*#__PURE__*/React.createElement("ul", {
    className: "folder-entries"
  }, entries.map(name => /*#__PURE__*/React.createElement("li", {
    key: name
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => setPath((path === '/' ? '' : path) + '/' + name)
  }, "\uD83D\uDCC1 ", name))))));
}
Object.assign(window, {
  Sidebar,
  TasksScreen,
  LogsScreen,
  SettingsScreen,
  SpeedTestPanel,
  FolderDialog
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/pcloud-sync/screens.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.MetricCard = __ds_scope.MetricCard;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.StatusPill = __ds_scope.StatusPill;

__ds_ns.NavItem = __ds_scope.NavItem;

__ds_ns.TaskCard = __ds_scope.TaskCard;

})();
