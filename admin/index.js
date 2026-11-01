// Forwards /_admin/* requests that carry the admin token to HWWineTracker's database (Durable Object in the main Worker).
// The backup token (for an optional Google Apps Script copy to Google Drive) opens only the backup paths.
// /_admin/run_backup (admin token) runs the nightly R2 backup on demand — same code as the main Worker's cron.
import { runBackup } from '../src/backup_r2.js';
const BACKUP_PATHS = ['/_admin/backup', '/_admin/backup_photos', '/_admin/backup_done'];
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const admin = env.ADMIN_TOKEN && req.headers.get('x-admin') === env.ADMIN_TOKEN;
    const bk = env.BACKUP_TOKEN && req.headers.get('x-backup') === env.BACKUP_TOKEN && BACKUP_PATHS.includes(u.pathname);
    if (!u.pathname.startsWith('/_admin/') || !(admin || bk)) return new Response('forbidden', { status: 403 });
    if (u.pathname === '/_admin/run_backup' && admin) {
      try { return Response.json(await runBackup(env, 'admin')); } catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
    }
    const inst = req.headers.get('x-instance') === 'practice' ? 'practice' : 'main';
    return env.CELLAR.get(env.CELLAR.idFromName(inst)).fetch(req);
  },
};
