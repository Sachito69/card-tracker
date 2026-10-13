const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./load-ts.cjs')
const card = (id,oracle='oracle') => ({id,oracle_id:oracle,name:'Counterspell'})
const item = (id,quantity,holder=1,role=null,extra={}) => ({id,quantity,holder_id:holder,loan_role:role,card:card('print-'+id),...extra})
test('decklist parses quantities and duplicate names; rejects malformed numeric prefixes',()=>{
  const {parseDecklist}=load('src/lib/decklist.ts')
  const parsed=parseDecklist('4 Counterspell\n1x Sol Ring\nIsland\n2 Counterspell')
  assert.deepEqual(parsed.lines.map(r=>[r.name,r.quantity]),[['Counterspell',6],['Sol Ring',1],['Island',1]])
  for(const bad of ['0 Island','-2 Island','1.5 Island','2.0 Island','999999999999999 Island']){
    assert.equal(parseDecklist(bad).errors.length,1,bad)
  }
})
test('progress matches editions, caps contribution, separates borrowing, excludes other decks and lending',()=>{
  const {calculateDeckProgress}=load('src/lib/decklist.ts')
  const entry={id:1,holder_id:1,card_id:'reference',identity_key:'oracle:oracle',desired_quantity:4,card:card('reference')}
  const result=calculateDeckProgress([entry],[item(1,2),item(2,1,1,'borrower'),item(3,2,1,'lender',{lent_quantity:2}),item(4,8,7)],1)
  assert.deepEqual([result.planned,result.placed,result.borrowed,result.missing],[4,3,1,1])
  const excess=calculateDeckProgress([entry],[item(1,6),{...item(8,1),card:card('other','other')}],1)
  assert.equal(excess.placed,4)
  assert.equal(excess.extras.reduce((n,r)=>n+r.quantity,0),3)
})
test('missing oracle IDs retain printing identity and reserved stacks are not fill sources',()=>{
  const {cardIdentity,eligibleFillSources}=load('src/lib/decklist.ts')
  assert.equal(cardIdentity(card('a',null)),'printing:a')
  const entry={identity_key:'oracle:oracle',holder_id:1}
  const rows=[item(1,2,null),item(2,3,2,null,{holder:{type:'binder'}}),item(3,2,3,'lender',{lent_quantity:1}),item(4,1,null,null,{reserved_quantity:1}),item(5,3,4,null,{holder:{type:'deck'}})]
  assert.deepEqual(eligibleFillSources(entry,rows).map(r=>r.id),[1,2])
})
test('separate borrowed loans from one inventory row have distinct rendered identities',()=>{
  const {collectionItemKey}=load('src/lib/decklist.ts')
  assert.notEqual(collectionItemKey(item(8,1,1,'borrower',{loan_transaction_id:11})),collectionItemKey(item(8,1,1,'borrower',{loan_transaction_id:12})))
})
