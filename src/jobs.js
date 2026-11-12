// The job pipeline (spec section 0).
//
//   queued -> resolving -> awaiting_input -> ready -> downloading -> processing -> done
//                                                                          \-> failed
//
// Downlink runs one job at a time (a batch queue is out of scope for v1.1), so the store holds
// the current job only. Everything else reports through here: the main process moves the job
// between stages and the window gets a sanitized snapshot of it on every change.

const { app } = require('electron');
const { randomUUID } = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

// Where each stage may go next. Cancelling a download returns the job to `ready`, so the
// options the user chose are still there; a failed job can be retried from either end.
const TRANSITIONS = {
  queued: ['resolving', 'failed'],
  resolving: ['awaiting_input', 'ready', 'failed'],
  awaiting_input: ['resolving', 'ready', 'downloading', 'failed'],
  ready: ['resolving', 'downloading', 'failed'],
  downloading: ['processing', 'done', 'failed', 'ready'],
  processing: ['done', 'failed', 'ready'],
  done: [],
  failed: ['resolving', 'ready'],
};

const RUNNING = new Set(['resolving', 'downloading', 'processing']);

function tempRoot() {
  return path.join(app.getPath('temp'), 'downlink');
}

// Secrets and process handles stay in the main process; this is what the window sees.
function snapshot(job) {
  return {
    id: job.id,
    sourceUrl: job.sourceUrl,
    resolver: job.resolver,
    status: job.status,
    title: job.title,
    durationSec: job.durationSec,
    fps: job.fps,
    formats: job.formats,
    selectedFormatId: job.selectedFormatId,
    clip: job.clip,
    preset: job.preset,
    thumbnail: job.thumbnail,
    needsPassword: job.status === 'awaiting_input' && job.needs === 'password',
    passwordTries: job.passwordTries || 0,
    wrongPassword: !!job.wrongPassword,
    progress: job.progress,
    outputPath: job.outputPath,
    existing: !!job.existing,
    cancelled: !!job.cancelled,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

class JobStore extends EventEmitter {
  constructor() {
    super();
    this.current = null;
  }

  isBusy() {
    return !!this.current && RUNNING.has(this.current.status);
  }

  create(sourceUrl, defaults = {}) {
    if (this.isBusy()) throw new Error('A download is already running.');
    this.discard();
    const job = {
      id: randomUUID(),
      sourceUrl,
      resolver: 'ytdlp',
      status: 'queued',
      preset: defaults.defaultPreset || 'original',
      thumbnail: { save: !!defaults.saveThumbnail, embed: defaults.embedThumbnail !== false },
      createdAt: Date.now(),
    };
    this.current = job;
    this.emit('update', snapshot(job));
    return job;
  }

  get(id) {
    return this.current && this.current.id === id ? this.current : null;
  }

  // Moves a job to the next stage and merges `patch` into it in one step.
  transition(job, status, patch = {}) {
    if (job.status !== status && !TRANSITIONS[job.status].includes(status)) {
      throw new Error(`Job can't go from ${job.status} to ${status}.`);
    }
    Object.assign(job, patch, { status });
    if (status === 'done' || status === 'failed') job.finishedAt = Date.now();
    // The password lives on the job only while it's needed, and never anywhere else.
    if (status === 'done') job.password = undefined;
    if (status === 'ready' || status === 'resolving') job.finishedAt = undefined;
    if (status !== 'downloading' && status !== 'processing') job.progress = undefined;
    if (status === 'done' || status === 'failed' || status === 'ready') this.cleanTemp(job);
    this.emit('update', snapshot(job));
    return job;
  }

  // Changes details without changing the stage (progress, a chosen format).
  update(job, patch) {
    Object.assign(job, patch);
    this.emit('update', snapshot(job));
  }

  fail(job, error) {
    if (job.status === 'failed') return job;
    return this.transition(job, 'failed', { error });
  }

  // Scratch space for this job's temporary files. Created on demand, removed when the job
  // finishes, fails or is cancelled.
  tempDir(job) {
    const dir = path.join(tempRoot(), job.id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  cleanTemp(job) {
    try {
      fs.rmSync(path.join(tempRoot(), job.id), { recursive: true, force: true });
    } catch {
      // nothing to clean
    }
  }

  // Drops an idle job (a fetched link the user moved on from).
  discard() {
    const job = this.current;
    if (!job) return;
    if (job.task && typeof job.task.cancel === 'function') job.task.cancel();
    this.cleanTemp(job);
    job.password = undefined;
    this.current = null;
  }

  // Leftovers from a crash or force-quit in an earlier run.
  sweepTemp() {
    try {
      fs.rmSync(tempRoot(), { recursive: true, force: true });
    } catch {
      // nothing to sweep
    }
  }
}

module.exports = { JobStore, snapshot, TRANSITIONS };
