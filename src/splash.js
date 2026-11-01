// v0.9.7 — opening splash screen (v1.0.1: plus the last nightly backup and where to check / download backups): shown once per browser session (first page opened), dismissed by a tap/click,
// the Enter/Escape key, or after 10 s. window.hwtSplash() shows it again (the HW logo calls it).
const NY = iso => { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return String(iso).replace('T', ' ').slice(0, 16) + ' UTC'; } };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// bk = { lb: app_meta last_backup JSON, le: app_meta last_backup_error JSON } (set per request in index.js)
function backupLine(bk) {
  let lb = null, le = null;
  try { lb = JSON.parse((bk && bk.lb) || 'null'); } catch (e) { lb = null; }
  try { le = JSON.parse((bk && bk.le) || 'null'); } catch (e) { le = null; }
  const when = lb ? `Last backup: <b>${esc(NY(lb.at))}</b>.` : 'No backup has been recorded yet.';
  const warn = le && (!lb || le.at > lb.at) ? `<span class="sp-warn">The last backup attempt failed (${esc(NY(le.at))}) — open Backups and press “Back up now”.</span>` : '';
  return `<p class="sp-bk">A full copy of the tracker is saved automatically every night. ${when} ${warn}
    Check the copies, or download one to keep on your laptop or Google Drive, under <a href="/backups">Reports › Backups</a>.</p>`;
}
export const splash = (VERSION, bk) => `<div id="hwsplash" role="dialog" aria-modal="true" aria-labelledby="hwsp-t" hidden>
<div class="sp-card"><div class="sp-badge">HW</div>
<h1 id="hwsp-t">Hermit Woods Wine Tracker</h1>
<p class="sp-by">Designed by Ken and Claude · October 2026</p>
<p class="sp-txt">Built on Hermit Woods' records kept in Vintrace (2019–2026) and Ken's Google Sheets, this program tracks all bottled stock, provides inputs for active wines, and produces all reporting.</p>
${backupLine(bk)}
<button type="button" class="sp-go">Open the tracker</button>
<p class="sp-v">Version ${VERSION}</p></div></div>
<style>#hwsplash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;
background:radial-gradient(ellipse at 50% 35%,#3a0f17 0%,#120509 70%);color:#f0e6e8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
transition:opacity .45s ease}#hwsplash[hidden]{display:none}#hwsplash.out{opacity:0}
#hwsplash .sp-card{max-width:440px;width:100%;text-align:center}
#hwsplash .sp-badge{width:76px;height:76px;margin:0 auto 18px;border-radius:18px;background:#7a1f2b;color:#fff;font:700 30px/76px Georgia,serif;letter-spacing:1px;box-shadow:0 6px 24px rgba(0,0,0,.45)}
#hwsplash h1{margin:0 0 6px;font:600 28px/1.2 Georgia,"Times New Roman",serif;color:#fff}
#hwsplash .sp-by{margin:0 0 18px;font-size:14px;color:#d8b4bb;letter-spacing:.3px}
#hwsplash .sp-txt{margin:0 0 16px;font-size:16px;line-height:1.5;color:#e6d6d9}
#hwsplash .sp-go{font:600 16px/1 inherit;font-family:inherit;padding:13px 26px;border-radius:10px;border:0;background:#c9a24a;color:#1a0a0d;cursor:pointer}
#hwsplash .sp-go:focus-visible{outline:2px solid #fff;outline-offset:3px}
#hwsplash .sp-bk{margin:0 0 22px;font-size:14px;line-height:1.5;color:#d8c4c8;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 14px}#hwsplash .sp-bk a{color:#e8c46a}#hwsplash .sp-bk b{color:#fff}#hwsplash .sp-warn{display:block;margin:6px 0;color:#ffa198;font-weight:600}
#hwsplash .sp-v{margin:16px 0 0;font-size:12px;color:#9c7f85}
@media (prefers-reduced-motion:reduce){#hwsplash{transition:none}}</style>
<script>(function(){var s=document.getElementById('hwsplash'),t;
function hide(){if(s.hidden)return;clearTimeout(t);s.classList.add('out');setTimeout(function(){s.hidden=true;s.classList.remove('out')},460);document.removeEventListener('keydown',key)}
function key(e){if(e.key==='Escape'||e.key==='Enter'){e.preventDefault();hide()}}
window.hwtSplash=function(auto){s.hidden=false;s.classList.remove('out');document.addEventListener('keydown',key);s.querySelector('.sp-go').focus({focusVisible:false});clearTimeout(t);if(auto)t=setTimeout(hide,10000)};
s.addEventListener('click',function(e){if(e.target.closest('a'))return;hide()});
var seen=false;try{seen=sessionStorage.getItem('hwt_splash')==='1';sessionStorage.setItem('hwt_splash','1')}catch(e){}
if(!seen)window.hwtSplash(true)})()</script>`;
