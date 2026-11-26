import { randomUUID, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { emptyState } from './core.mjs';

export const COLLECTION = 'wallstreet_newsletter_v1';
const STATE_OUTPUT_LIMIT = 64*1024*1024;
const digest = text => createHash('sha256').update(text).digest('hex');
function encode(state) {
  const json=JSON.stringify(state), bytes=Buffer.from(json);
  if(bytes.length>STATE_OUTPUT_LIMIT)throw Error('wallstreet_state_capacity');
  let base64=bytes.toString('base64'), encoding='json';
  // Preserve captions and outbox state when verbose evidence approaches the transaction limit.
  if(base64.length>24*300000){base64=gzipSync(bytes).toString('base64');encoding='gzip';}
  const chunks=base64.match(/.{1,300000}/g) || [''];
  if(chunks.length>24) throw Error('wallstreet_state_capacity'); // < 10 MiB transaction request
  return {chunks,hash:digest(json),encoding};
}
function decode(head,snaps) {
  if(!head) return emptyState();
  const encoded=snaps.map((s,i)=>{
    const d=s.data();
    if(!s.exists || d?.revision!==head.revision || d?.index!==i || typeof d?.base64!=='string') throw Error('wallstreet_state_corrupt');
    return d.base64;
  }).join('');
  const bytes=Buffer.from(encoded,'base64');
  const json=(head.encoding==='gzip'?gunzipSync(bytes,{maxOutputLength:STATE_OUTPUT_LIMIT}):bytes).toString('utf8');
  if(digest(json)!==head.hash) throw Error('wallstreet_state_corrupt');
  const state=JSON.parse(json);
  if(state.version!==1 || !state.videos || !state.budgets) throw Error('wallstreet_state_corrupt');
  return state;
}
function headOf(snap) {
  if(!snap.exists) return null;
  const h=snap.data();
  if(h?.schema!==1 || !Number.isSafeInteger(h.revision) || h.revision<0 || !Number.isSafeInteger(h.count) || h.count<1 || h.count>24 || typeof h.hash!=='string' || (h.encoding!==undefined&&!['json','gzip'].includes(h.encoding))) throw Error('wallstreet_head_corrupt');
  return h;
}
/** Same injected @google-cloud/firestore instance and ADC as existing CEO store.
 * All state, cost reservations, chunks and lock ownership use Firestore transactions.
 * Non-expiring lock intentionally requires manual recovery after an uncertain operation.
 * No external API calls run inside a transaction callback (Firestore may replay callbacks).
 */
export class FirestoreWallstreetStore {
  constructor(db) { this.db=db; this.col=db.collection(COLLECTION); this.head=this.col.doc('head'); }
  chunk(i) {return this.col.doc(`state-${String(i).padStart(3,'0')}`);}
  async read() {
    // Consistent snapshot only: never take the worker ownership lock or write state.
    return this.db.runTransaction(async tx=>{
      const head=headOf(await tx.get(this.head));
      const snaps=[];
      if(head) for(let i=0;i<head.count;i++) snaps.push(await tx.get(this.chunk(i)));
      return decode(head,snaps);
    }, {readOnly:true});
  }
  async exclusive(fn) {
    const owner=randomUUID(); let revision;
    const state=await this.db.runTransaction(async tx=>{
      const head=headOf(await tx.get(this.head));
      if(head?.owner) throw Error('wallstreet_locked');
      const snaps=[];
      if(head) for(let i=0;i<head.count;i++) snaps.push(await tx.get(this.chunk(i)));
      const s=decode(head,snaps), enc=encode(s);
      revision=head?.revision ?? 0;
      if(!head) enc.chunks.forEach((base64,index)=>tx.set(this.chunk(index),{revision,index,base64}));
      tx.set(this.head,{schema:1,revision,count:head?.count??enc.chunks.length,hash:head?.hash??enc.hash,encoding:head?head.encoding??'json':enc.encoding,owner,lockedAt:Date.now()});
      return s;
    });
    const save=async()=>{
      const enc=encode(state), expected=revision;
      await this.db.runTransaction(async tx=>{
        const h=headOf(await tx.get(this.head));
        if(h?.owner!==owner || h.revision!==expected) throw Error('wallstreet_lock_lost');
        const next=expected+1;
        enc.chunks.forEach((base64,index)=>tx.set(this.chunk(index),{revision:next,index,base64}));
        for(let i=enc.chunks.length;i<h.count;i++) tx.delete(this.chunk(i));
        tx.set(this.head,{...h,revision:next,count:enc.chunks.length,hash:enc.hash,encoding:enc.encoding});
      });
      revision=expected+1;
    };
    // Deliberately no finally/unlock on failure: uncertain commits must fail closed.
    const result=await fn(state,save);
    await this.db.runTransaction(async tx=>{
      const h=headOf(await tx.get(this.head));
      if(h?.owner!==owner || h.revision!==revision) throw Error('wallstreet_lock_lost');
      tx.set(this.head,{...h,owner:null,lockedAt:null});
    });
    return result;
  }
}
