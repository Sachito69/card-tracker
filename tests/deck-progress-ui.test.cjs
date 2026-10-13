const {test}=require('node:test')
const assert=require('node:assert/strict')
const React=require('react')
const {renderToStaticMarkup}=require('react-dom/server')
const {load}=require('./load-ts.cjs')
test('deck row filtering does not alter overall progress totals',()=>{
  const {DeckProgress}=load('src/components/DeckProgress.tsx')
  const entries=[{id:1,holder_id:1,identity_key:'oracle:ring',desired_quantity:4,card:{id:'ring',oracle_id:'ring',name:'Sol Ring'}},
    {id:2,holder_id:1,identity_key:'oracle:island',desired_quantity:2,card:{id:'island',oracle_id:'island',name:'Island'}}]
  const html=renderToStaticMarkup(React.createElement(DeckProgress,{deck:{id:1,name:'Test'},entries,items:[],onEdit(){},onFill(){},matchesEntry:e=>e.card.name==='Island'}))
  assert.match(html,/0 \/ 6 placed/)
  assert.match(html,/>Island</)
  assert.doesNotMatch(html,/>Sol Ring</)
})
