'use strict';
/**
 * Minimal in-process job queue with bounded concurrency and retries.
 * Deliberately dependency-free so the app runs anywhere; the same interface
 * (add / on-complete) can be swapped for BullMQ + Redis in production by
 * replacing this file.
 */
class Queue {
  constructor(name, handler, { concurrency = 2, maxRetries = 2 } = {}) {
    this.name = name;
    this.handler = handler;
    this.concurrency = concurrency;
    this.maxRetries = maxRetries;
    this.q = [];
    this.active = 0;
  }

  add(data) {
    this.q.push({ data, attempts: 0 });
    this._drain();
  }

  size() { return this.q.length; }

  _drain() {
    while (this.active < this.concurrency && this.q.length) {
      const job = this.q.shift();
      this.active += 1;
      Promise.resolve()
        .then(() => this.handler(job.data))
        .catch((err) => {
          job.attempts += 1;
          if (job.attempts <= this.maxRetries) { this.q.push(job); }
          else console.error(`[queue:${this.name}] job failed:`, err.message);
        })
        .finally(() => { this.active -= 1; this._drain(); });
    }
  }
}

module.exports = { Queue };
