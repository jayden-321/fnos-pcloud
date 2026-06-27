// Fake but realistic data for the pCloud NAS Sync UI kit.
window.KIT_DATA = {
  version: '0.3.7',
  tasks: [
    {
      id: 't1', name: 'Finance backup', enabled: true,
      localPath: '/vol1/1000/finance', remotePath: '/Sync/Finance',
      schedule: 'Daily 02:00',
      status: 'success', statusLabel: 'Sync complete',
      scanMode: 'Remote diff',
      scanDetail: 'Local 1,284 · Remote 1,266 · Local scan 0.4s · Remote diff 0.2s',
      stats: { total: 1284, existing: 1266, synced: 18, pending: 0, failed: 0 },
    },
    {
      id: 't2', name: 'Photo archive', enabled: true,
      localPath: '/vol1/1000/photos', remotePath: '/Sync/Photos',
      schedule: 'Every 300s',
      status: 'uploading', statusLabel: 'Syncing',
      scanMode: 'Full remote comparison',
      scanDetail: 'Local 8,420 · Remote 8,100 · Local scan 1.8s · Remote listing 6.4s',
      stats: { total: 8420, existing: 8100, synced: 96, pending: 224, failed: 0 },
    },
    {
      id: 't3', name: 'Work documents', enabled: true,
      localPath: '/vol1/1000/work', remotePath: '/Sync/Work',
      schedule: 'Weekly Mon 09:00',
      status: 'failed', statusLabel: 'Syncing',
      scanMode: 'Local cache',
      scanDetail: 'Local 542 · Mtime differs 3',
      stats: { total: 542, existing: 528, synced: 8, pending: 3, failed: 3 },
    },
  ],
  logs: [
    { file: 'finance/2026/Q1-report.xlsx', size: '4.2 MB', task: 'finance', time: '2026-06-27 02:00:14', status: 'success', statusText: 'Success', progress: '' },
    { file: 'photos/2026/IMG_4821.HEIC', size: '3.1 MB', task: 'photos', time: '2026-06-27 02:14:03', status: 'uploading', statusText: 'Uploading', progress: '1.9 MB / 3.1 MB (61%)' },
    { file: 'photos/2026/IMG_4820.HEIC', size: '2.8 MB', task: 'photos', time: '2026-06-27 02:13:58', status: 'success', statusText: 'Success', progress: '' },
    { file: 'work/contracts/lease-final.pdf', size: '880 KB', task: 'work', time: '2026-06-27 02:01:22', status: 'failed', statusText: 'Failed', progress: '' },
    { file: 'finance/2026/invoices-jan.zip', size: '12.4 MB', task: 'finance', time: '2026-06-27 02:00:09', status: 'success', statusText: 'Success', progress: '' },
    { file: 'work/notes/standup.md', size: '6 KB', task: 'work', time: '2026-06-27 02:01:05', status: 'success', statusText: 'Success', progress: '' },
    { file: 'photos/2026/IMG_4815.HEIC', size: '3.4 MB', task: 'photos', time: '2026-06-27 02:12:40', status: 'success', statusText: 'Success', progress: '' },
  ],
  totals: { total: 10246, synced: 122, existing: 9894, failed: 3, pending: 227, uploading: 1, speed: '1.2 MB/s' },
  folders: {
    '/': ['vol1', 'vol2'],
    '/vol1': ['1000', 'docker'],
    '/vol1/1000': ['finance', 'photos', 'work', 'media'],
  },
};
