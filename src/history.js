// Download history (spec section 8): a JSON file in the app's data folder, written atomically
// and capped at the history limit. Only page URLs are stored, never a captured stream URL,
// token or password.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function file() {
  return path.join(app.getPath('userData'), 'history.json');
}

function thumbsDir() {
  return path.join(app.getPath('userData'), 'thumbs');
}

function thumbPathFor(id) {
  return path.join(thumbsDir(), `${id}.jpg`);
}

function read() {
  try {
    const list = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Write to a temp file, then rename over the real one.
function write(list) {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, target);
}

// Newest first. A job that fails and is then retried keeps one entry, updated in place.
function upsert(entry, limit = 1000) {
  const list = read().filter((e) => e.id !== entry.id);
  list.unshift(entry);
  const kept = limit > 0 ? list.slice(0, limit) : list;
  list.slice(kept.length).forEach((old) => fs.rmSync(thumbPathFor(old.id), { force: true }));
  write(kept);
  return entry;
}

function find(id) {
  return read().find((e) => e.id === id) || null;
}

function remove(id) {
  write(read().filter((e) => e.id !== id));
  fs.rmSync(thumbPathFor(id), { force: true });
}

function clear() {
  write([]);
  fs.rmSync(thumbsDir(), { recursive: true, force: true });
}

// Entries with a flag for files that have moved, filtered by a search over title and site.
function list(query = '') {
  const q = String(query || '').trim().toLowerCase();
  return read()
    .filter((e) => !q || `${e.title} ${e.site}`.toLowerCase().includes(q))
    .map((e) => ({ ...e, fileExists: !!e.outputPath && fs.existsSync(e.outputPath), hasThumb: fs.existsSync(thumbPathFor(e.id)) }));
}

function thumbDataUrl(id) {
  try {
    return `data:image/jpeg;base64,${fs.readFileSync(thumbPathFor(id)).toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = { upsert, find, remove, clear, list, thumbDataUrl, thumbPathFor, read };
