const {test}=require('node:test')
const assert=require('node:assert/strict')
const {load}=require('./load-ts.cjs')
test('preferences isolate accounts and contexts and tolerate corrupted/unavailable storage',()=>{
  const store=new Map()
  global.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)}
  const {loadPreferences,savePreferences}=load('src/lib/preferences.ts')
  const defaults=loadPreferences('a','cards')
  savePreferences('a','cards',{...defaults,ownership:'borrowed',sort:'quantity',view:'text'})
  assert.equal(loadPreferences('a','cards').ownership,'borrowed')
  assert.equal(loadPreferences('b','cards').ownership,'all')
  assert.equal(loadPreferences('a','deck:1').ownership,'all')
  assert.equal(loadPreferences('a','deck:1').view,'text')
  store.set('tracker-preferences:a:cards','{bad')
  assert.equal(loadPreferences('a','cards').view,'images')
  store.set('tracker-preferences:a:cards',JSON.stringify({ownership:'bad',view:'bad',filters:{colors:['INVALID']}}))
  assert.equal(loadPreferences('a','cards').ownership,'all')
  assert.deepEqual(loadPreferences('a','cards').filters.colors,[])
  global.localStorage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}}
  assert.equal(loadPreferences('a','cards').sort,'name')
  assert.doesNotThrow(()=>savePreferences('a','cards',defaults))
  delete global.localStorage
})
