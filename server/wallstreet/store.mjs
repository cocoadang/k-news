import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyState } from './core.mjs';

// Single host persistent volume only. Do not place this on ephemeral Cloud Run disk.
// A crash intentionally leaves the lock: an operator must reconcile inflight work before removal.
export class FileStore {
  constructor(path) { this.path=path; }
  async exclusive(fn) {
    await mkdir(dirname(this.path), { recursive:true });
    const lock=await open(this.path+'.lock','wx');
    try {
      let state;
      try { state=JSON.parse(await readFile(this.path,'utf8')); }
      catch(e) { if(e.code !== 'ENOENT') throw e; state=emptyState(); }
      if (state.version !== 1 || !state.videos || !state.budgets) throw Error('invalid_state');
      const save=async()=>{
        const file=await open(this.path+'.tmp','w');
        try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
        finally { await file.close(); }
        await rename(this.path+'.tmp',this.path);
      };
      return await fn(state,save);
    } finally { await lock.close(); await unlink(this.path+'.lock'); }
  }
}
