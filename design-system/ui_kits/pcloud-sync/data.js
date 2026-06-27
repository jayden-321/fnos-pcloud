// Fake but realistic data for the pCloud NAS Sync UI kit.
window.KIT_DATA = {
  version: '0.3.7',
  tasks: [
    {
      id: 't1', name: '财务备份', enabled: true,
      localPath: '/vol1/1000/finance', remotePath: '/Sync/Finance',
      schedule: '每天 02:00',
      status: 'success', statusLabel: '同步完成',
      scanMode: '远端增量',
      scanDetail: '本地 1,284 · 远端 1,266 · 本地扫描 0.4s · 远端增量 0.2s',
      stats: { total: 1284, existing: 1266, synced: 18, pending: 0, failed: 0 },
    },
    {
      id: 't2', name: '照片归档', enabled: true,
      localPath: '/vol1/1000/photos', remotePath: '/Sync/Photos',
      schedule: '按间隔 300s',
      status: 'uploading', statusLabel: '同步中',
      scanMode: '远端全量比对',
      scanDetail: '本地 8,420 · 远端 8,100 · 本地扫描 1.8s · 远端列举 6.4s',
      stats: { total: 8420, existing: 8100, synced: 96, pending: 224, failed: 0 },
    },
    {
      id: 't3', name: '工作文档', enabled: true,
      localPath: '/vol1/1000/work', remotePath: '/Sync/Work',
      schedule: '每周 一 09:00',
      status: 'failed', statusLabel: '同步中',
      scanMode: '本地缓存',
      scanDetail: '本地 542 · 时间不同 3',
      stats: { total: 542, existing: 528, synced: 8, pending: 3, failed: 3 },
    },
  ],
  logs: [
    { file: 'finance/2026/Q1-report.xlsx', size: '4.2 MB', task: 'finance', time: '2026-06-27 02:00:14', status: 'success', statusText: '成功', progress: '' },
    { file: 'photos/2026/IMG_4821.HEIC', size: '3.1 MB', task: 'photos', time: '2026-06-27 02:14:03', status: 'uploading', statusText: '上传中', progress: '1.9 MB / 3.1 MB (61%)' },
    { file: 'photos/2026/IMG_4820.HEIC', size: '2.8 MB', task: 'photos', time: '2026-06-27 02:13:58', status: 'success', statusText: '成功', progress: '' },
    { file: 'work/contracts/lease-final.pdf', size: '880 KB', task: 'work', time: '2026-06-27 02:01:22', status: 'failed', statusText: '失败', progress: '' },
    { file: 'finance/2026/invoices-jan.zip', size: '12.4 MB', task: 'finance', time: '2026-06-27 02:00:09', status: 'success', statusText: '成功', progress: '' },
    { file: 'work/notes/standup.md', size: '6 KB', task: 'work', time: '2026-06-27 02:01:05', status: 'success', statusText: '成功', progress: '' },
    { file: 'photos/2026/IMG_4815.HEIC', size: '3.4 MB', task: 'photos', time: '2026-06-27 02:12:40', status: 'success', statusText: '成功', progress: '' },
  ],
  totals: { total: 10246, synced: 122, existing: 9894, failed: 3, pending: 227, uploading: 1, speed: '1.2 MB/s' },
  folders: {
    '/': ['vol1', 'vol2'],
    '/vol1': ['1000', 'docker'],
    '/vol1/1000': ['finance', 'photos', 'work', 'media'],
  },
};
