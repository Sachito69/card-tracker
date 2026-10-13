const {test}=require('node:test');const assert=require('node:assert/strict');const {load}=require('./load-ts.cjs');
const {parseBulkInput,selectBulkPrinting}=load('src/lib/bulkImport.ts');
test('bulk input preserves exact version and foil',()=>{
 assert.deepEqual(parseBulkInput('1 Consecrated Sphinx (PF26) 4 *F*').input,{raw:'1 Consecrated Sphinx (PF26) 4 *F*',quantity:1,name:'Consecrated Sphinx',setCode:'pf26',collectorNumber:'4',foil:true});
 assert.equal(parseBulkInput('4x Sol Ring').input.quantity,4);
 assert.equal(parseBulkInput('1 Fire // Ice').input.name,'Fire // Ice');
 assert.equal(parseBulkInput('1 Who (What) When').input.name,'Who (What) When');
 for(const s of ['0 Sol Ring','1.5 Sol Ring','Sol Ring','1 Sol Ring 4','1 Sol Ring (PF26) 4 *X*'])assert.ok(parseBulkInput(s).error,s);
 assert.equal(parseBulkInput('2 Card (SET) 123a').input.collectorNumber,'123a');
});
test('printing resolution does not substitute version or finish',()=>{
 const cards=[{id:'a',name:'Consecrated Sphinx',set:'pf26',collector_number:'4',finishes:['foil']},{id:'b',name:'Consecrated Sphinx',set:'abc',collector_number:'4',finishes:['nonfoil']}];
 const input=parseBulkInput('1 Consecrated Sphinx (PF26) 4 *F*').input;
 assert.equal(selectBulkPrinting(input,cards).id,'a');
 assert.throws(()=>selectBulkPrinting({...input,collectorNumber:'5'},cards),/printing/i);
 assert.throws(()=>selectBulkPrinting({...input,foil:false},cards),/finish/i);
 assert.equal(selectBulkPrinting(parseBulkInput('1 Consecrated Sphinx').input,cards).id,'b');
 assert.throws(()=>selectBulkPrinting({...input,name:'Sphinx'},cards),/name/i);
});
test('successful bulk occurrences survive reordering without consuming new duplicate rows',()=>{
 const {retainAddedBulkRows}=load('src/lib/bulkImport.ts');
 const old=[{id:1,raw:'1 Sphinx',status:'added'},{id:2,raw:'1 Sol Ring',status:'added'}];
 const current=[{id:0,raw:'1 Sol Ring',status:'waiting'},{id:1,raw:'1 Sphinx',status:'waiting'},{id:2,raw:'1 Sphinx',status:'waiting'}];
 assert.deepEqual(retainAddedBulkRows(current,old).map(row=>[row.id,row.status]),[[0,'added'],[1,'added'],[2,'waiting']]);
});
