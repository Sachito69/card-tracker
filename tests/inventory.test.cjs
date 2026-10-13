const {test}=require('node:test');const assert=require('node:assert/strict');const {load}=require('./load-ts.cjs');
const {inventoryDeckProgress,isOwnedInventory}=load('src/lib/inventory.ts');
test('deck totals separate missing, lent and borrowed copies',()=>{
 const rows=[{holder_id:1,quantity:4,is_missing:true},{holder_id:1,quantity:3,is_missing:false,lent_quantity:1},{holder_id:1,quantity:1,is_missing:false,loan_role:'borrower'},{holder_id:2,quantity:9,is_missing:true}];
 assert.deepEqual(inventoryDeckProgress(rows,1),{present:3,missing:4,total:7,borrowed:1});
 assert.equal(isOwnedInventory(rows[0]),false);assert.equal(isOwnedInventory(rows[1]),true);assert.equal(isOwnedInventory(rows[2]),false);
});
