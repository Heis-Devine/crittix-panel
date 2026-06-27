const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn, exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const AdmZip = require('adm-zip');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const CONFIG = {
  password: process.env.PANEL_PASSWORD || 'R!v3r$T0rm_92!XqZ',
  port: process.env.PORT || 3000,
  botDir: process.env.BOT_DIR || path.join(process.env.HOME, 'bot'),
  startCmd: process.env.START_CMD || 'node index.js',
};

// Ensure bot dir exists
if (!fs.existsSync(CONFIG.botDir)) fs.mkdirSync(CONFIG.botDir, { recursive: true });

let botProcess = null;
let botLogs = [];

const addLog = (text, type = 'info') => {
  const entry = { text, type, time: new Date().toLocaleTimeString() };
  botLogs.push(entry);
  if (botLogs.length > 500) botLogs.shift();
  io.emit('log', entry);
};

// Session
app.use(session({
  secret: 'crittix-panel-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth middleware
const auth = (req, res, next) => {
  if (req.session.authed) return next();
  res.redirect('/login');
};

// File upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CONFIG.botDir),
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// ─── Routes ───────────────────────────────────────────────

app.get('/login', (req, res) => res.send(loginPage()));

app.post('/login', (req, res) => {
  if (req.body.password === CONFIG.password) {
    req.session.authed = true;
    res.redirect('/');
  } else {
    res.send(loginPage('Wrong password'));
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/', auth, (req, res) => res.send(dashboardPage()));

app.post('/start', auth, (req, res) => {
  if (botProcess) return res.json({ ok: false, msg: 'Already running' });
  const cmd = req.body.cmd || CONFIG.startCmd;
  CONFIG.startCmd = cmd;
  const [bin, ...args] = cmd.split(' ');
  botProcess = spawn(bin, args, { cwd: CONFIG.botDir, env: { ...process.env } });
  botProcess.stdout.on('data', d => addLog(d.toString().trim(), 'out'));
  botProcess.stderr.on('data', d => addLog(d.toString().trim(), 'err'));
  botProcess.on('exit', code => {
    addLog(`Process exited with code ${code}`, 'sys');
    botProcess = null;
    io.emit('status', 'stopped');
  });
  addLog(`Started: ${cmd}`, 'sys');
  io.emit('status', 'running');
  res.json({ ok: true });
});

app.post('/stop', auth, (req, res) => {
  if (!botProcess) return res.json({ ok: false, msg: 'Not running' });
  botProcess.kill('SIGTERM');
  addLog('Stopped by user', 'sys');
  res.json({ ok: true });
});

app.post('/restart', auth, (req, res) => {
  if (botProcess) {
    botProcess.kill('SIGTERM');
    botProcess = null;
  }
  setTimeout(() => {
    const cmd = CONFIG.startCmd;
    const [bin, ...args] = cmd.split(' ');
    botProcess = spawn(bin, args, { cwd: CONFIG.botDir, env: { ...process.env } });
    botProcess.stdout.on('data', d => addLog(d.toString().trim(), 'out'));
    botProcess.stderr.on('data', d => addLog(d.toString().trim(), 'err'));
    botProcess.on('exit', code => {
      addLog(`Process exited with code ${code}`, 'sys');
      botProcess = null;
      io.emit('status', 'stopped');
    });
    addLog(`Restarted: ${cmd}`, 'sys');
    io.emit('status', 'running');
  }, 1000);
  res.json({ ok: true });
});

app.post('/install', auth, (req, res) => {
  const pkg = req.body.packages || '';
  const cmd = pkg ? `npm install ${pkg}` : 'npm install';
  addLog(`Running: ${cmd}`, 'sys');
  exec(cmd, { cwd: CONFIG.botDir }, (err, stdout, stderr) => {
    if (stdout) addLog(stdout.trim(), 'out');
    if (stderr) addLog(stderr.trim(), 'err');
    if (err) addLog('Install failed', 'err');
    else addLog('Install complete ✓', 'sys');
  });
  res.json({ ok: true });
});

app.post('/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ ok: false, msg: 'No file' });
  // Auto-extract zip
  if (req.file.originalname.endsWith('.zip')) {
    try {
      const zip = new AdmZip(req.file.path);
      zip.extractAllTo(CONFIG.botDir, true);
      fs.unlinkSync(req.file.path);
      addLog(`Extracted: ${req.file.originalname}`, 'sys');
    } catch (e) {
      addLog(`Zip error: ${e.message}`, 'err');
    }
  } else {
    addLog(`Uploaded: ${req.file.originalname}`, 'sys');
  }
  res.json({ ok: true });
});

app.get('/files', auth, (req, res) => {
  try {
    const files = fs.readdirSync(CONFIG.botDir).map(f => {
      const stat = fs.statSync(path.join(CONFIG.botDir, f));
      return { name: f, size: stat.size, isDir: stat.isDirectory() };
    });
    res.json(files);
  } catch { res.json([]); }
});

app.delete('/files/:name', auth, (req, res) => {
  const fp = path.join(CONFIG.botDir, req.params.name);
  try { fs.rmSync(fp, { recursive: true }); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, msg: e.message }); }
});

app.get('/config', auth, (req, res) => res.json({ startCmd: CONFIG.startCmd, botDir: CONFIG.botDir }));
app.post('/config', auth, (req, res) => {
  if (req.body.startCmd) CONFIG.startCmd = req.body.startCmd;
  if (req.body.botDir) CONFIG.botDir = req.body.botDir;
  res.json({ ok: true });
});

app.get('/status', auth, (req, res) => res.json({ running: !!botProcess, cmd: CONFIG.startCmd }));
app.get('/logs', auth, (req, res) => res.json(botLogs));

// ─── Socket ───────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('status', botProcess ? 'running' : 'stopped');
  socket.emit('logs', botLogs);
});

server.listen(CONFIG.port, () => {
  console.log(`\n🔥 Crittix Panel running on port ${CONFIG.port}`);
  console.log(`🔑 Password: ${CONFIG.password}`);
  console.log(`📁 Bot dir: ${CONFIG.botDir}\n`);
});

// ─── HTML Pages ───────────────────────────────────────────

function loginPage(err = '') {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crittix Panel</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#e0e0e0;font-family:'Courier New',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{background:#111118;border:1px solid #7c3aed;border-radius:12px;padding:40px;width:340px;box-shadow:0 0 40px #7c3aed33}
h1{color:#a855f7;font-size:1.4rem;margin-bottom:8px;text-align:center}
p{color:#666;font-size:.8rem;text-align:center;margin-bottom:28px}
input{width:100%;background:#0a0a0f;border:1px solid #333;border-radius:8px;padding:12px;color:#e0e0e0;font-family:inherit;font-size:.9rem;margin-bottom:16px;outline:none}
input:focus{border-color:#7c3aed}
button{width:100%;background:#7c3aed;border:none;border-radius:8px;padding:13px;color:#fff;font-family:inherit;font-size:.95rem;cursor:pointer;font-weight:bold;letter-spacing:1px}
button:hover{background:#6d28d9}
.err{color:#f87171;font-size:.8rem;text-align:center;margin-top:12px}
.skull{font-size:2.5rem;text-align:center;margin-bottom:16px}
</style></head><body>
<div class="box">
  <div class="skull">💀</div>
  <h1>CRITTIX PANEL</h1>
  <p>Bot Management System</p>
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="Enter password" autofocus>
    <button type="submit">ACCESS</button>
  </form>
  ${err ? `<div class="err">⚠ ${err}</div>` : ''}
</div></body></html>`;
}

function dashboardPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crittix Panel</title>
<script src="/socket.io/socket.io.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--purple:#7c3aed;--purple2:#a855f7;--bg:#0a0a0f;--card:#111118;--border:#1e1e2e;--text:#e0e0e0;--muted:#555;--green:#22c55e;--red:#ef4444;--yellow:#eab308}
body{background:var(--bg);color:var(--text);font-family:'Courier New',monospace;min-height:100vh}
header{background:var(--card);border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;justify-content:space-between}
header h1{color:var(--purple2);font-size:1.1rem;letter-spacing:2px}
.badge{padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:bold}
.badge.running{background:#16a34a22;color:var(--green);border:1px solid #16a34a44}
.badge.stopped{background:#dc262622;color:var(--red);border:1px solid #dc262644}
.logout{color:var(--muted);text-decoration:none;font-size:.8rem}
.logout:hover{color:var(--red)}
main{padding:16px;max-width:900px;margin:0 auto;display:grid;gap:14px}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px}
.card h2{font-size:.8rem;color:var(--muted);letter-spacing:2px;margin-bottom:14px;text-transform:uppercase}
.btns{display:flex;gap:10px;flex-wrap:wrap}
.btn{padding:10px 20px;border:none;border-radius:8px;font-family:inherit;font-size:.85rem;font-weight:bold;cursor:pointer;letter-spacing:1px;transition:.15s}
.btn-green{background:#16a34a;color:#fff}.btn-green:hover{background:#15803d}
.btn-red{background:#dc2626;color:#fff}.btn-red:hover{background:#b91c1c}
.btn-yellow{background:#ca8a04;color:#fff}.btn-yellow:hover{background:#a16207}
.btn-purple{background:var(--purple);color:#fff}.btn-purple:hover{background:#6d28d9}
.btn-gray{background:#1e1e2e;color:var(--text);border:1px solid #333}.btn-gray:hover{background:#2a2a3e}
.btn:disabled{opacity:.4;cursor:not-allowed}
#console{background:#050508;border:1px solid #1a1a2e;border-radius:8px;height:280px;overflow-y:auto;padding:12px;font-size:.75rem;line-height:1.6}
.log-out{color:#a5f3fc}.log-err{color:#fca5a5}.log-sys{color:#c4b5fd}
input[type=text],input[type=password]{background:#050508;border:1px solid #333;border-radius:8px;padding:10px 12px;color:var(--text);font-family:inherit;font-size:.85rem;outline:none;width:100%}
input:focus{border-color:var(--purple)}
.row{display:flex;gap:8px}
.row input{flex:1}
.file-list{display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto}
.file-item{display:flex;align-items:center;justify-content:space-between;background:#050508;border-radius:6px;padding:8px 12px;font-size:.8rem}
.file-name{color:#a5f3fc}.file-size{color:var(--muted);font-size:.7rem}
.del-btn{background:none;border:none;color:var(--red);cursor:pointer;font-size:.9rem;padding:0 4px}
.drop-zone{border:2px dashed #333;border-radius:8px;padding:24px;text-align:center;color:var(--muted);font-size:.85rem;cursor:pointer;transition:.15s}
.drop-zone:hover,.drop-zone.drag{border-color:var(--purple);color:var(--purple2)}
.toast{position:fixed;bottom:20px;right:20px;background:#1e1e2e;border:1px solid var(--purple);border-radius:8px;padding:12px 20px;font-size:.85rem;opacity:0;transition:.3s;pointer-events:none}
.toast.show{opacity:1}
</style></head><body>
<header>
  <h1>💀 CRITTIX PANEL</h1>
  <div style="display:flex;align-items:center;gap:14px">
    <span class="badge stopped" id="statusBadge">STOPPED</span>
    <a href="/logout" class="logout">logout</a>
  </div>
</header>

<main>
  <!-- Controls -->
  <div class="card">
    <h2>Bot Controls</h2>
    <div style="margin-bottom:12px">
      <label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:6px">START COMMAND</label>
      <div class="row">
        <input type="text" id="cmdInput" placeholder="node index.js">
        <button class="btn btn-gray" onclick="saveCmd()">Save</button>
      </div>
    </div>
    <div class="btns">
      <button class="btn btn-green" id="startBtn" onclick="control('start')">▶ START</button>
      <button class="btn btn-red" id="stopBtn" onclick="control('stop')" disabled>■ STOP</button>
      <button class="btn btn-yellow" id="restartBtn" onclick="control('restart')" disabled>↺ RESTART</button>
    </div>
  </div>

  <!-- Console -->
  <div class="card">
    <h2>Console Output</h2>
    <div id="console"></div>
    <div style="margin-top:8px;display:flex;gap:8px">
      <button class="btn btn-gray" onclick="clearConsole()" style="font-size:.75rem;padding:6px 14px">Clear</button>
    </div>
  </div>

  <!-- Install -->
  <div class="card">
    <h2>Install Dependencies</h2>
    <div class="row">
      <input type="text" id="pkgInput" placeholder="Leave empty for npm install, or type: express socket.io">
      <button class="btn btn-purple" onclick="installPkg()">Install</button>
    </div>
  </div>

  <!-- Upload -->
  <div class="card">
    <h2>File Upload</h2>
    <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileInput').click()">
      📁 Click or drag files here<br><span style="font-size:.75rem">ZIP files will be auto-extracted</span>
    </div>
    <input type="file" id="fileInput" style="display:none" multiple onchange="uploadFiles(this.files)">
  </div>

  <!-- Files -->
  <div class="card">
    <h2>Files in Bot Directory <button class="btn btn-gray" onclick="loadFiles()" style="font-size:.7rem;padding:4px 10px;margin-left:8px">Refresh</button></h2>
    <div class="file-list" id="fileList"></div>
  </div>
</main>

<div class="toast" id="toast"></div>

<script>
const socket = io();
let isRunning = false;

socket.on('status', s => setStatus(s === 'running'));
socket.on('log', entry => appendLog(entry));
socket.on('logs', logs => { document.getElementById('console').innerHTML = ''; logs.forEach(appendLog); });

fetch('/config').then(r=>r.json()).then(c => {
  document.getElementById('cmdInput').value = c.startCmd || 'node index.js';
});

function setStatus(running) {
  isRunning = running;
  const badge = document.getElementById('statusBadge');
  badge.textContent = running ? 'RUNNING' : 'STOPPED';
  badge.className = 'badge ' + (running ? 'running' : 'stopped');
  document.getElementById('startBtn').disabled = running;
  document.getElementById('stopBtn').disabled = !running;
  document.getElementById('restartBtn').disabled = !running;
}

function appendLog(entry) {
  const el = document.getElementById('console');
  const div = document.createElement('div');
  div.className = 'log-' + (entry.type || 'out');
  div.textContent = `[${entry.time}] ${entry.text}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function clearConsole() { document.getElementById('console').innerHTML = ''; }

async function control(action) {
  const cmd = document.getElementById('cmdInput').value;
  const r = await fetch('/' + action, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({cmd}) });
  const d = await r.json();
  toast(d.msg || action + ' sent');
}

async function saveCmd() {
  const cmd = document.getElementById('cmdInput').value;
  await fetch('/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({startCmd: cmd}) });
  toast('Command saved ✓');
}

async function installPkg() {
  const pkg = document.getElementById('pkgInput').value;
  await fetch('/install', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({packages: pkg}) });
  toast('Installing...');
}

async function uploadFiles(files) {
  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    await fetch('/upload', { method:'POST', body: fd });
  }
  toast('Upload complete ✓');
  loadFiles();
}

async function loadFiles() {
  const files = await fetch('/files').then(r=>r.json());
  const list = document.getElementById('fileList');
  list.innerHTML = files.length ? '' : '<div style="color:var(--muted);font-size:.8rem">No files found</div>';
  files.forEach(f => {
    const d = document.createElement('div');
    d.className = 'file-item';
    d.innerHTML = \`<div><span class="file-name">\${f.isDir ? '📁 ' : '📄 '}\${f.name}</span><span class="file-size"> \${f.isDir ? 'dir' : (f.size/1024).toFixed(1)+'kb'}</span></div>
    <button class="del-btn" onclick="deleteFile('\${f.name}')">🗑</button>\`;
    list.appendChild(d);
  });
}

async function deleteFile(name) {
  if (!confirm('Delete ' + name + '?')) return;
  await fetch('/files/' + encodeURIComponent(name), { method:'DELETE' });
  toast('Deleted ✓');
  loadFiles();
}

// Drag and drop
const dz = document.getElementById('dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); uploadFiles(e.dataTransfer.files); });

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

loadFiles();
</script>
</body></html>`;
}
