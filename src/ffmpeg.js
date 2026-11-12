// Runs the bundled ffmpeg (spec section 0.3): arguments as an array, never a shell string,
// progress read from `-progress pipe:1`, SIGTERM to cancel.

const { execFile, spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';

// The bundled static ffmpeg has no certificate store of its own; point it at macOS's.
function toolEnv() {
  return IS_WIN ? { ...process.env } : { SSL_CERT_FILE: '/etc/ssl/cert.pem', ...process.env };
}

// Resolves { code, stderr, cancelled }. `durationSec` turns out_time into a percentage.
function runFfmpeg({ ffmpegPath, args, durationSec, onProgress }) {
  const child = spawn(ffmpegPath, args, {
    detached: !IS_WIN,
    windowsHide: true,
    env: toolEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cancelled = false;
  let stderr = '';
  let remainder = '';

  child.stdout.on('data', (chunk) => {
    const lines = (remainder + chunk.toString()).split('\n');
    remainder = lines.pop();
    for (const line of lines) {
      // Despite the name, out_time_ms is in microseconds.
      const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
      if (m && durationSec > 0 && onProgress) {
        onProgress(Math.min(100, (Number(m[1]) / 1e6 / durationSec) * 100));
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-20000);
  });

  const promise = new Promise((resolve) => {
    child.on('error', (err) => resolve({ code: -1, stderr: err.message, cancelled }));
    child.on('close', (code) => resolve({ code, stderr, cancelled }));
  });

  function cancel() {
    if (cancelled) return;
    cancelled = true;
    killTree(child);
  }
  return { promise, cancel };
}

// Stops a child and anything it started; the hard kill follows if it ignores the first.
function killTree(child) {
  if (IS_WIN) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // already exited
  }
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already exited
      }
    }
  }, 3000);
}

module.exports = { runFfmpeg, killTree, toolEnv };
