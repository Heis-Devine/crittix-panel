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

if (!fs.existsSync(CONFIG.botDir)) fs.mkdirSync(CONFIG.botDir, { recursive: true });

let botProcess = null;
let botLogs = [];

const addLog = (text, type = 'info') => {
  const entry = { text, type, time: new Date().toLocaleTimeString() };
  botLogs.push(entry);
  if (botLogs.length > 500) botLogs.shift();
  io.emit('log', entry);
};

app.use(session({
  secret: 'crittix-panel-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const auth = (req, res, next) => {
  if (req.session.authed) return next();
  res.redirect('/login');
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CONFIG.botDir),
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/login', (req, res) => {
  if (req.body.password === CONFIG.password) {
    req.session.authed = true;
    res.redirect('/');
  } else {
    res.redirect('/login?err=1');
  }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });
app.get('/', auth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/start', auth, (req, res) => {
  if (botProcess) return res.json({ ok: false, msg: 'Already running' });
  const cmd = req.body.cmd || CONFIG.startCmd;
  CONFIG.startCmd = cmd;
  const [bin, ...args] = cmd.split(' ');
  botProcess = spawn(bin, args, { cwd: CONFIG.botDir, env: { ...process.env } });
  botProcess.stdout.on('data', d => addLog(d.toString().trim(), 'out'));
  botProcess.stderr.on('data', d => addLog(d.toString().trim(), 'err'));
  botProcess.on('exit', code => {
    addLog('Process exited with code ' + code, 'sys');
    botProcess = null;
    io.emit('status', 'stopped');
  });
  addLog('Started: ' + cmd, 'sys');
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
  if (botProcess) { botProcess.kill('SIGTERM'); botProcess = null; }
  setTimeout(() => {
    const cmd = CONFIG.startCmd;
    const [bin, ...args] = cmd.split(' ');
    botProcess = spawn(bin, args, { cwd: CONFIG.botDir, env: { ...process.env } });
    botProcess.stdout.on('data', d => addLog(d.toString().trim(), 'out'));
    botProcess.stderr.on('data', d => addLog(d.toString().trim(), 'err'));
    botProcess.on('exit', code => {
      addLog('Process exited with code ' + code, 'sys');
      botProcess = null;
      io.emit('status', 'stopped');
    });
    addLog('Restarted: ' + cmd, 'sys');
    io.emit('status', 'running');
  }, 1000);
  res.json({ ok: true });
});

app.post('/install', auth, (req, res) => {
  const pkg = req.body.packages || '';
  const cmd = pkg ? 'npm install ' + pkg : 'npm install';
  addLog('Running: ' + cmd, 'sys');
  exec(cmd, { cwd: CONFIG.botDir }, (err, stdout, stderr) => {
    if (stdout) addLog(stdout.trim(), 'out');
    if (stderr) addLog(stderr.trim(), 'err');
    addLog(err ? 'Install failed' : 'Install complete', 'sys');
  });
  res.json({ ok: true });
});

app.post('/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ ok: false, msg: 'No file' });
  if (req.file.originalname.endsWith('.zip')) {
    try {
      const zip = new AdmZip(req.file.path);
      zip.extractAllTo(CONFIG.botDir, true);
      fs.unlinkSync(req.file.path);
      addLog('Extracted: ' + req.file.originalname, 'sys');
    } catch (e) { addLog('Zip error: ' + e.message, 'err'); }
  } else {
    addLog('Uploaded: ' + req.file.originalname, 'sys');
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
  try {
    fs.rmSync(path.join(CONFIG.botDir, req.params.name), { recursive: true });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, msg: e.message }); }
});

app.get('/config', auth, (req, res) => res.json({ startCmd: CONFIG.startCmd, botDir: CONFIG.botDir }));
app.post('/config', auth, (req, res) => {
  if (req.body.startCmd) CONFIG.startCmd = req.body.startCmd;
  if (req.body.botDir) CONFIG.botDir = req.body.botDir;
  res.json({ ok: true });
});

app.get('/status', auth, (req, res) => res.json({ running: !!botProcess, cmd: CONFIG.startCmd }));
app.get('/logs', auth, (req, res) => res.json(botLogs));

io.on('connection', (socket) => {
  socket.emit('status', botProcess ? 'running' : 'stopped');
  socket.emit('logs', botLogs);
});

server.listen(CONFIG.port, () => {
  console.log('Crittix Panel running on port ' + CONFIG.port);
  console.log('Password: ' + CONFIG.password);
  console.log('Bot dir: ' + CONFIG.botDir);
});
