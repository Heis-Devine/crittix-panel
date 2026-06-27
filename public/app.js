const socket = io();

socket.on('status', s => setStatus(s === 'running'));
socket.on('log', entry => appendLog(entry));
socket.on('logs', logs => {
  document.getElementById('console').innerHTML = '';
  logs.forEach(appendLog);
});

fetch('/config').then(r => r.json()).then(c => {
  document.getElementById('cmdInput').value = c.startCmd || 'node index.js';
});

function setStatus(running) {
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
  div.textContent = '[' + entry.time + '] ' + entry.text;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function clearConsole() {
  document.getElementById('console').innerHTML = '';
}

async function control(action) {
  const cmd = document.getElementById('cmdInput').value;
  const r = await fetch('/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd })
  });
  const d = await r.json();
  toast(d.msg || action + ' sent');
}

async function saveCmd() {
  const cmd = document.getElementById('cmdInput').value;
  await fetch('/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startCmd: cmd })
  });
  toast('Command saved');
}

async function installPkg() {
  const pkg = document.getElementById('pkgInput').value;
  await fetch('/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packages: pkg })
  });
  toast('Installing... check console');
}

async function uploadFiles(files) {
  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    await fetch('/upload', { method: 'POST', body: fd });
  }
  toast('Upload complete');
  loadFiles();
}

async function loadFiles() {
  const files = await fetch('/files').then(r => r.json());
  const list = document.getElementById('fileList');
  if (!files.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:.8rem">No files found</div>';
    return;
  }
  list.innerHTML = '';
  files.forEach(f => {
    const d = document.createElement('div');
    d.className = 'file-item';
    const icon = f.isDir ? '📁' : '📄';
    const size = f.isDir ? 'dir' : (f.size / 1024).toFixed(1) + 'kb';
    d.innerHTML =
      '<div><span class="file-name">' + icon + ' ' + f.name + '</span>' +
      '<span class="file-size"> ' + size + '</span></div>' +
      '<button class="del-btn" onclick="deleteFile(\'' + f.name + '\')">🗑</button>';
    list.appendChild(d);
  });
}

async function deleteFile(name) {
  if (!confirm('Delete ' + name + '?')) return;
  await fetch('/files/' + encodeURIComponent(name), { method: 'DELETE' });
  toast('Deleted');
  loadFiles();
}

// Drag and drop
const dz = document.getElementById('dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('drag');
  uploadFiles(e.dataTransfer.files);
});

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

loadFiles();
