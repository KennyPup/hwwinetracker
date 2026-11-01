/**
 * HWWineTracker — daily backup to Google Drive (runs in Ken's Google account, no laptop needed).
 *
 * Every day around 3 am (New York time) this script asks the HWWineTracker admin Worker on Cloudflare for a full copy
 * of the database and saves it in My Drive / HW / HWWineTracker backups:
 *   main/      HWWineTracker_main_YYYY-MM-DD.ndjson.gz      the real records (every table, ~2 MB)
 *   practice/  HWWineTracker_practice_YYYY-MM-DD.ndjson.gz  the practice copy
 *   photos/    <id>__<file name>.jpg                         note photos (only new ones are added each day)
 * Daily copies are kept 30 days; the copy made on the 1st of each month is kept for good.
 * Restore: tools/restore_backup.py in HW\claude_work\cloud\hwwinetracker turns a file (+ the photos folder) back into
 * a SQLite database. If a run fails, Google emails the owner (Apps Script's standard trigger-failure notice).
 *
 * One-time setup:
 *   1. Project Settings (gear icon) → Script Properties → Add: BACKUP_TOKEN = the text in
 *      HW\claude_work\.secrets\hwt_backup_token.txt
 *   2. Back in the Editor, choose the function "setup" and press Run; allow access when Google asks.
 *      setup() makes the first backup straight away and schedules the daily one.
 */
var CONFIG = {
  url: 'https://hwwinetracker-admin.ken-7ec.workers.dev',
  folderId: '1ussz24eA9oXdOuhKzmSsJb_kM0dwBNf9',   // My Drive / HW / HWWineTracker backups
  instances: ['main', 'practice'],
  keepDays: 30,
  hour: 3
};

function setup() {
  token_();   // fails early with a clear message if the token is missing
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runBackup').timeBased().everyDays(1).atHour(CONFIG.hour).create();
  runBackup();
  Logger.log('Daily backup scheduled for about %s:00 (%s).', CONFIG.hour, Session.getScriptTimeZone());
}

function runBackup() {
  var root = DriveApp.getFolderById(CONFIG.folderId);
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var saved = [];
  CONFIG.instances.forEach(function (inst) {
    var resp = call_('/_admin/backup', inst);
    var blob = resp.getBlob();
    var text = Utilities.ungzip(blob.setContentType('application/x-gzip')).getDataAsString();
    var tail = text.slice(-4000);
    if (text.indexOf('{"hwt_backup":1') !== 0 || tail.indexOf('{"end":true') < 0)
      throw new Error('Backup of ' + inst + ' is incomplete (no end marker) — not saved.');
    var name = 'HWWineTracker_' + inst + '_' + today + '.ndjson.gz';
    var dir = sub_(root, inst);
    var old = dir.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);   // a re-run on the same day replaces that day's file
    var f = dir.createFile(blob.setName(name).setContentType('application/gzip'));
    saved.push({ inst: inst, name: name, bytes: f.getSize() });
    prune_(dir);
  });
  var nph = savePhotos_(sub_(root, 'photos'));
  var main = saved[0];
  call_('/_admin/backup_done', 'main', { file: main.name, bytes: main.bytes, photos: nph, folder: 'My Drive/HW/HWWineTracker backups' });
  Logger.log('Saved %s; %s new photo(s).', JSON.stringify(saved), nph);
}

function savePhotos_(dir) {
  var props = PropertiesService.getScriptProperties();
  var after = Number(props.getProperty('LAST_PHOTO_ID') || 0), n = 0;
  for (var guard = 0; guard < 200; guard++) {
    var list = JSON.parse(call_('/_admin/backup_photos?after=' + after + '&limit=20', 'main').getContentText());
    if (!list.length) break;
    list.forEach(function (p) {
      var fname = p.id + '__' + String(p.file_name || 'photo.jpg').replace(/[\\\/:*?"<>|]/g, '_');
      if (!dir.getFilesByName(fname).hasNext())
        dir.createFile(Utilities.newBlob(Utilities.base64Decode(p.data), p.mime || 'image/jpeg', fname));
      after = p.id; n++;
    });
    props.setProperty('LAST_PHOTO_ID', String(after));
  }
  return n;
}

function prune_(dir) {
  var cutoff = Date.now() - CONFIG.keepDays * 86400000;
  var it = dir.getFiles();
  while (it.hasNext()) {
    var f = it.next(), m = f.getName().match(/_(\d{4}-\d{2}-(\d{2}))\.ndjson\.gz$/);
    if (m && m[2] !== '01' && f.getDateCreated().getTime() < cutoff) f.setTrashed(true);   // to Drive Trash (30-day undo)
  }
}

function call_(path, inst, postBody) {
  var opt = { method: postBody ? 'post' : 'get', muteHttpExceptions: true,
              headers: { 'x-backup': token_(), 'x-instance': inst } };
  if (postBody) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(postBody); }
  var r = UrlFetchApp.fetch(CONFIG.url + path, opt);
  if (r.getResponseCode() !== 200)
    throw new Error(path + ' (' + inst + ') returned ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  return r;
}

function sub_(root, name) {
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function token_() {
  var t = PropertiesService.getScriptProperties().getProperty('BACKUP_TOKEN');
  if (!t) throw new Error('Add the script property BACKUP_TOKEN first (Project Settings → Script Properties).');
  return t.trim();
}
