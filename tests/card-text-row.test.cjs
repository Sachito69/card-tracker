const {test}=require('node:test');const assert=require('node:assert/strict');const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {load}=require('./load-ts.cjs');
const {CardTextRow}=load('src/components/CardTextRow.tsx');
test('missing text rows have metadata and acquisition action without artwork',()=>{
 const item={id:1,is_missing:true,quantity:3,condition:'NM',foil:true,holder:{type:'deck',name:'Yuriko'},card:{name:'Consecrated Sphinx',set_name:'Promo',set_code:'pf26',collector_number:'4',image_url:'art.jpg'}};
 const html=renderToStaticMarkup(React.createElement(CardTextRow,{item,onSelect:()=>{},onAcquire:()=>{}}));
 assert.ok(!html.includes('<img'));for(const text of ['Consecrated Sphinx','PF26','4','Foil','Missing','Deck - Yuriko','Mark acquired'])assert.ok(html.includes(text),text);
});
