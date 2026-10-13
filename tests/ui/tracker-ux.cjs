const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const path = require('node:path')
const me = '11111111-1111-4111-8111-111111111111'
const friend = '22222222-2222-4222-8222-222222222222'
const created_at = '2026-10-10T12:00:00Z'
const art = 'http://127.0.0.1:5180/fixture-card.svg'
const holders = [
  { id: 1, user_id: me, name: 'Yuriko', type: 'deck', format: 'Commander' },
  { id: 2, user_id: me, name: 'Trade binder', type: 'binder' },
  { id: 3, user_id: me, name: 'Blue staples', type: 'box' },
].map(h=>({...h,notes:null,created_at}))
const catalog = { oracle_id:'ring-oracle', id: 'ring', name: 'Sol Ring', image_url: art, colors: [], color_identity: [], cmc: 1, type_line: 'Artifact', set_name: 'Commander', set_code: 'cmd', collector_number: '1', legalities: {} }
const owned = [
  { id: 1, user_id: me, card_id: 'ring', holder_id: 1, quantity: 3, condition: 'NM', foil: false, card: catalog, holder: holders[0],created_at },
  { id: 2, user_id: me, card_id: 'ring', holder_id: null, quantity: 4, condition: 'LP', foil: false, card: {...catalog,name:'Counterspell'},holder:null,created_at },
]
const outgoing = [{ id: 10, source_item_id: 2, owner_id: me, recipient_user_id: friend, quantity: 2, status: 'active' }]
let borrowedHolder = 3
const calls = []
let failSearch = true
let failBulkAdd=false
const importedCatalog=new Map()
let inventoryWrites=0
const card = (id, name, set_name='Commander Masters') => ({
  id, oracle_id:'ring-oracle', name, set:'cmm', set_name, collector_number:id, finishes:['nonfoil','foil'], image_uris:{normal:art}, type_line:'Artifact',
})

async function fixture(page) {
  await page.addInitScript(({ me }) => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.'+btoa(JSON.stringify({sub:me,exp:2000000000}))+'.fake'
    localStorage.setItem('sb-tracker-test-auth-token', JSON.stringify({
      access_token:token, refresh_token:'fake', expires_at:2000000000,
      expires_in:3600,token_type:'bearer',user:{id:me,email:'fixture@example.test'},
    }))
  },{me})
  await page.route('**/fixture-card.svg', r => r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680"><rect width="488" height="680" rx="22" fill="#36373c"/><rect x="20" y="20" width="448" height="58" rx="8" fill="#ad9b76"/><text x="40" y="60" font-size="28">Sol Ring</text><rect x="25" y="90" width="438" height="320" fill="#496574"/><circle cx="244" cy="255" r="100" fill="none" stroke="#d8b95d" stroke-width="25"/><rect x="25" y="430" width="438" height="210" fill="#d4c9b1"/><text x="45" y="480" font-size="22">Artifact</text></svg>'}))
  await page.route('https://tracker-test.supabase.co/**', async r => {
    const url = new URL(r.request().url())
    const table=url.pathname.split('/').pop()
    const q=url.searchParams
    let data=[]
    if(url.pathname.includes('/auth/')) data={id:me,email:'fixture@example.test'}
    else if(url.pathname.includes('/rpc/')) {
      const body=r.request().postDataJSON(); calls.push({name:table,body})
      if(table==='move_borrowed_with_undo') borrowedHolder=body.p_holder_id
      if(table==='acquire_missing_stack'){
        const src=owned.find(row=>row.id===body.p_item_id)
        if(!src)return r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Missing card changed; refresh and try again',code:'23514'})})
        const dest=owned.find(row=>!row.is_missing&&row.holder_id===src.holder_id&&row.card_id===src.card_id&&row.condition===src.condition&&row.foil===src.foil)
        if(dest)dest.quantity+=body.p_quantity
        else owned.push({...src,id:100+inventoryWrites++,is_missing:false,quantity:body.p_quantity})
        src.quantity-=body.p_quantity
        if(!src.quantity)owned.splice(owned.indexOf(src),1)
      }
      if(table==='add_inventory_stack'){
        if(failBulkAdd&&body.p_card_id==='1'){failBulkAdd=false;return r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Temporary add failure',code:'23514'})})}
        inventoryWrites++
        const cc=importedCatalog.get(body.p_card_id)??catalog
        owned.push({id:100+inventoryWrites,user_id:me,card_id:body.p_card_id,holder_id:body.p_holder_id,quantity:body.p_quantity,condition:body.p_condition,foil:body.p_foil,is_missing:body.p_is_missing,card:cc,holder:holders.find(h=>h.id===body.p_holder_id)??null,created_at})
      }
      data=null
    } else if(table==='card_catalog'){data=r.request().postDataJSON();importedCatalog.set(data.id,data)}
    else if(table==='friendships')data=[{user_a:me,user_b:friend,status:'accepted'}]
    else if(table==='collection_items'){
      if(r.request().method()!=='GET'){inventoryWrites++;data=r.request().postDataJSON()}
      else data=q.get('is_missing')==='eq.false'?owned.filter(row=>!row.is_missing):owned
    }
    else if(table==='holders') {if(r.request().method()!=='GET'){data={...r.request().postDataJSON(),id:20};holders.push(data)}else data=holders}
    else if(table==='profiles') data=r.request().headers().accept?.includes('object') ? {user_id:me,username:'Sacho'} : [{user_id:me,username:'Sacho'},{user_id:friend,username:'Lexi'}]
    else if(table==='contacts') data=[{id:7,name:'Justin'}]
    else if(table==='card_transactions') {
      const status=q.get('status')??''
      if(q.has('or')) data=[
        {id:20,owner_id:me,recipient_contact_id:7,transaction_type:'sale',status:'completed',quantity:1,created_at,completed_at:created_at,card:{name:'Sol Ring'}},
        {id:21,owner_id:friend,recipient_user_id:me,transaction_type:'loan',status:'completed',quantity:1,created_at,completed_at:created_at,card:{name:'Island'}},
      ]
      else if(q.get('owner_id')==='eq.'+me && status.includes('active')) data=outgoing
      else if(q.get('recipient_user_id')==='eq.'+me && status.includes('active')) data=[{id:11,owner_id:friend,recipient_user_id:me,source_item_id:8,card_id:'ring',quantity:1,condition:'NM',foil:false,status:'active',borrower_holder_id:borrowedHolder,created_at,card:{...catalog,name:'Borrowed Ring'}}]
    }
    await r.fulfill({contentType:'application/json',body:JSON.stringify(data)})
  })
  await page.route('https://api.scryfall.com/**', async r => {
    const q=new URL(r.request().url()).searchParams.get('q')??''
    if(q.includes('RetryCard') && failSearch) {
      failSearch=false
      return r.fulfill({status:503,contentType:'application/json',body:'{}'})
    }
    if(q.includes('Slow')) await new Promise(resolve=>setTimeout(resolve,650))
    const names=q.includes('Consecrated Sphinx')?[{...card('sphinx','Consecrated Sphinx','Promo 2026'),set:'pf26',collector_number:'4'}]:q.startsWith('!') ? [card('1',q.slice(2,-1)),card('2',q.slice(2,-1),'Commander 2018'),card('3',q.slice(2,-1),'Secret Lair')]
      : [card('result',q.includes('RetryCard')?'RetryCard':q.includes('Slow')?'Slow Ring':'Sol Ring')]
    await r.fulfill({contentType:'application/json',body:JSON.stringify({data:names,has_more:false})})
  })
}

;(async()=>{
  process.env.VITE_SUPABASE_URL='https://tracker-test.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY='fixture-anon-key'
  const {createServer}=await import('../../node_modules/vite/dist/node/index.js')
  const server=await createServer({root:path.resolve(__dirname,'../..'),server:{host:'127.0.0.1',port:5180}})
  await server.listen()
  const browser=await chromium.launch({executablePath:process.env.TRACKER_BROWSER,args:['--single-process','--no-zygote']})
  try {
    const page=await browser.newPage()
    await fixture(page)
    for(const width of (process.env.TRACKER_WIDTHS?process.env.TRACKER_WIDTHS.split(",").map(Number):[1280,390,360])){
      borrowedHolder=3
      owned.splice(0,owned.length,
        {id:1,user_id:me,card_id:'ring',holder_id:1,quantity:3,condition:'NM',foil:false,is_missing:false,card:catalog,holder:holders[0],created_at},
        {id:2,user_id:me,card_id:'ring',holder_id:null,quantity:4,condition:'LP',foil:false,is_missing:false,card:{...catalog,name:'Counterspell'},holder:null,created_at},
        {id:50,user_id:me,card_id:'ring',holder_id:1,quantity:4,condition:'NM',foil:false,is_missing:true,card:catalog,holder:holders[0],created_at})
      holders.splice(3)
      if(page.url().startsWith("http"))await page.evaluate(()=>localStorage.clear())
      const height=width===360?640:900
      await page.setViewportSize({width,height})
      const errors=[]
      page.on('pageerror',e=>errors.push(e.message))
      await page.goto('http://127.0.0.1:5180')
      await page.locator('.cardTile').first().waitFor()
      assert.equal(await page.locator('.cardTile').count(),3)
      assert.equal(await page.locator('.imageShell .loanBadge,.imageShell .qtyBadge').count(),0)
      assert.match(await page.locator('.cardGrid').textContent(),/Deck - Yuriko/)
      assert.match(await page.locator('.cardGrid').textContent(),/2× lent · Lexi/)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      if(width<768) assert.equal((await page.locator('.cardGrid').evaluate(el=>getComputedStyle(el).gridTemplateColumns)).split(' ').length,2)
      await page.getByRole('button',{name:'Borrowed',exact:true}).click()
      assert.equal(await page.locator('.cardTile').count(),1)
      await page.getByRole('button',{name:'All',exact:true}).click()
      await page.getByLabel('Collection view').selectOption('text')
      assert.equal(await page.locator('.cardTextList').count(),1)
      assert.equal(await page.locator('.cardTextList img').count(),0)
      assert.match(await page.locator('.cardTextList').textContent(),/CMD #1/)
      await page.getByLabel('Collection view').selectOption('images')
      await page.screenshot({path:path.resolve(__dirname,`cards-${width}.png`)})

      await page.locator('.lentCard .cardTileMain').click()
      assert.equal(await page.locator('.modal input[type=number]').isDisabled(),true)
      assert.equal(await page.locator('.modal input[type=checkbox]').isDisabled(),true)
      await page.locator('.modalHeader .iconButton').click()
      await page.locator('.borrowedCard .cardTileMain').click()
      assert.equal(await page.locator('.borrowedMovePanel').count(),0)
      await page.getByRole('button',{name:'Move',exact:true}).click()
      await page.locator('.modal select').selectOption('2')
      await page.getByRole('button',{name:'Move cards',exact:true}).click()
      await page.locator('.modal').waitFor({state:'hidden'})
      assert.deepEqual(calls.at(-1),{name:'move_borrowed_with_undo',body:{p_transaction_id:11,p_holder_id:2}})

      await page.locator('.cardTile:not(.lentCard):not(.borrowedCard) .cardTileMain').click()
      await page.getByRole('button',{name:'Move',exact:true}).click()
      await page.locator('.modal input[type=number]').fill('1')
      await page.locator('.modal select').selectOption('2')
      await page.getByRole('button',{name:'Move cards',exact:true}).click()
      await page.locator('.confirmDialog').waitFor()
      assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.confirmDialog')),true)
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.confirmDialog')),true)
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('.confirmDialog').count(),0)
      assert.equal(await page.locator('.modal select').count(),1)
      await page.getByRole('button',{name:'Close dialog',exact:true}).click()
      await page.getByRole('button',{name:'Lend',exact:true}).click()
      await page.locator('.modal select').selectOption('friend:'+friend)
      await page.getByRole('button',{name:'Lend cards',exact:true}).click()
      await page.locator('.confirmDialog .primaryButton').click()
      await page.locator('.modal').waitFor({state:'hidden'})
      assert.equal(calls.at(-1).name,'create_user_transaction')
      assert.equal(calls.at(-1).body.p_source_item_id,1)
      assert.equal(calls.at(-1).body.p_quantity,1)

      const nav=width<768?page.locator('.mobileBottomNav'):page.locator('.desktopTopbar')
      await nav.getByRole('button',{name:/Collection/}).click()
      await page.locator(width<768?'.mobileSheetGrid':'.collectionDropdown').getByRole('button',{name:'Decks',exact:true}).click()
      const style=await page.locator('.holderRowMain').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderWidth}))
      assert.equal(style.bg,'rgba(0, 0, 0, 0)')
      assert.equal(style.border,'0px')
      await page.screenshot({path:path.resolve(__dirname,`holders-${width}.png`)})
      await page.locator('.holderRowMain').click()
      await page.getByText('3 / 7 present').waitFor()
      assert.equal(await page.locator('.cardTextList img,.deckContentsList img').count(),0)
      await page.locator('.inventoryTextRow.missingCard .acquireButton').click()
      await page.getByLabel('Copies acquired').fill('1')
      await page.getByRole('button',{name:'Mark acquired',exact:true}).last().click()
      await page.getByText('4 / 7 present').waitFor()
      assert.match(await page.locator('.inventoryDeckProgress').textContent(),/3 missing/)
      await page.locator('.searchBox input').fill('not-a-card')
      assert.match(await page.locator('.inventoryDeckProgress').textContent(),/4 \/ 7/)
      await page.locator('.searchBox input').fill('')
      await page.screenshot({path:path.resolve(__dirname,`deck-${width}.png`)})
      await page.getByRole('button',{name:'Back',exact:true}).click()
      const chooseView=async name=>{
        await nav.getByRole('button',{name:/Collection/}).click()
        await page.locator(width<768?'.mobileSheetGrid':'.collectionDropdown').getByRole('button',{name,exact:true}).click()
      }
      await chooseView('Wishlist')
      await page.getByLabel('Collection view').selectOption('text')
      assert.equal(await page.locator('.inventoryTextRow').count(),1)
      assert.match(await page.locator('.inventoryTextRow').textContent(),/×3.*Sol Ring.*Deck - Yuriko/)
      assert.equal(await page.locator('.inventoryTextRow img').count(),0)
      await page.getByRole('button',{name:'Mark acquired',exact:true}).click()
      await page.getByRole('button',{name:'Mark acquired',exact:true}).last().click()
      await page.locator('.inventoryTextRow').waitFor({state:'hidden'})
      await chooseView('Containers')
      assert.equal(await page.locator('.holderRowMain').count(),2)
      await page.locator(width<768?'.mobileAddButton':'.addContextButton').click()
      await page.getByLabel('Container type').selectOption('box')
      await page.getByLabel('Name',{exact:true}).fill('New box')
      await page.getByRole('button',{name:'Create box',exact:true}).click()
      await page.getByText('New box',{exact:true}).waitFor()
      await chooseView('Decks');await page.locator('.holderRowMain').first().click()
      await page.locator(width<768?'.mobileAddButton':'.addContextButton').click()
      await page.getByRole('heading',{name:'Add missing card',exact:true}).waitFor()
      await page.getByRole('button',{name:'Bulk add',exact:true}).click()
      await page.getByLabel('Bulk list').fill('1 Consecrated Sphinx (PF26) 4 *F*\n1 Sol Ring')
      await page.getByRole('button',{name:'Search cards',exact:true}).click()
      await page.getByRole('button',{name:'Add 2 found',exact:true}).waitFor()
      assert.match(await page.locator('.bulkResults').textContent(),/PF26.*#4.*Foil/)
      failBulkAdd=true
      const beforeBulk=calls.length
      await page.getByRole('button',{name:'Add 2 found',exact:true}).dblclick()
      await page.getByRole('button',{name:'Add 1 found',exact:true}).waitFor()
      await page.getByRole('button',{name:'Add 1 found',exact:true}).click()
      await page.getByRole('button',{name:'Search cards',exact:true}).waitFor()
      assert.equal(calls.slice(beforeBulk).filter(c=>c.name==='add_inventory_stack'&&c.body.p_card_id==='sphinx').length,1)
      const sphinx=calls.slice(beforeBulk).find(c=>c.name==='add_inventory_stack'&&c.body.p_card_id==='sphinx').body
      assert.equal(sphinx.p_is_missing,true);assert.equal(sphinx.p_holder_id,1);assert.equal(sphinx.p_foil,true)
      if(!process.env.SKIP_BULK_REORDER){
        await page.getByLabel('Bulk list').fill('1 Sol Ring\n1 Consecrated Sphinx (PF26) 4 *F*')
        await page.getByRole('button',{name:'Search cards',exact:true}).click()
        await page.getByRole('button',{name:'Search cards',exact:true}).waitFor()
        assert.equal(await page.getByRole('button',{name:'Add 0 found',exact:true}).count(),1,'Reordered successful rows must stay Added')
      }

      await page.getByRole('button',{name:'Close Add Card'}).click()
      await page.getByRole('button',{name:'Back',exact:true}).click()
      await chooseView('Wishlist')
      await page.getByLabel('Collection view').selectOption('text')
      await page.locator('.inventoryTextRow').filter({hasText:'Consecrated Sphinx'}).getByRole('button',{name:'Mark acquired',exact:true}).click()
      const removed=owned.find(row=>row.card_id==='sphinx'&&row.is_missing)
      owned.splice(owned.indexOf(removed),1)
      await page.locator('.modal').getByRole('button',{name:'Mark acquired',exact:true}).click()
      await page.locator('.modal').getByText(/Missing card changed/).waitFor()
      await page.waitForTimeout(100)
      assert.equal(await page.locator('.modal').getByRole('button',{name:'Mark acquired',exact:true}).isDisabled(),true,'Missing source must disable acquisition')
      assert.match(await page.locator('.modal').textContent(),/no longer missing|no longer available/)
      await page.getByRole('button',{name:'Close dialog',exact:true}).click()
      await chooseView('Cards')

      await nav.getByRole('button',{name:/Menu/}).click()
      await page.locator(width<768?'.mobileActionList':'.mainDropdown').getByRole('button',{name:/History/}).click()
      await page.getByText('Sacho → Justin').waitFor()
      assert.match(await page.locator('.historyBody').innerText(),/Lexi → Sacho/)
      assert.match(await page.locator('.historyBody').innerText(),/Returned/)
      await page.locator('.modalHeader .iconButton').click()

      await page.locator(width<768?'.mobileAddButton':'.addContextButton').click()
      const initial=await page.locator('.cardLookupPanel').boundingBox()
      const input=page.locator('.cardSearchInput input')
      failSearch=true
      await input.fill('RetryCard')
      await page.getByRole('button',{name:'Retry',exact:true}).waitFor()
      await page.getByRole('button',{name:'Retry',exact:true}).click()
      await page.locator('.cardSearchResult').waitFor()
      assert.match(await page.locator('.cardSearchResult').innerText(),/RetryCard/)
      await input.fill('Slow')
      await page.waitForTimeout(340)
      await input.fill('Sol')
      await page.locator('.cardSearchResult').waitFor()
      await page.waitForTimeout(700)
      assert.match(await page.locator('.cardSearchResult').innerText(),/Sol Ring/)
      await page.locator('.cardSearchResult').click()
      await page.locator('.printingOption').nth(2).waitFor()
      assert.equal(await page.locator('.printingOption').count(),3)
      await page.locator('.printingOption').nth(1).click()
      assert.equal(await page.locator('.printingOption').nth(1).getAttribute('aria-pressed'),'true')
      assert.equal(await page.locator('.addCardFooter .primaryButton').isVisible(),true)
      const action=await page.locator('.addCardFooter').boundingBox()
      assert.ok(action.y+action.height<=height)
      const final=await page.locator('.cardLookupPanel').boundingBox()
      assert.equal(final.height,initial.height)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      await page.getByLabel('Filter printings').fill('Commander 2018')
      assert.equal(await page.locator('.printingOption').count(),1)
      await page.getByLabel('Filter printings').fill('unmatched')
      assert.equal(await page.locator('.printingOption').count(),0)
      assert.match(await page.locator('.selectedPrintingSummary').innerText(),/Commander 2018/)
      await page.getByLabel('Filter printings').fill('')
      await page.screenshot({path:path.resolve(__dirname,`add-${width}.png`)})
      const beforeWrites=inventoryWrites
      await page.getByRole('button',{name:'Add another',exact:true}).dblclick()
      await page.waitForFunction(()=>document.querySelector('.cardSearchInput input')?.value==='')
      assert.equal(inventoryWrites-beforeWrites,1)
      assert.equal(await page.locator('.addCardModal').count(),1)
      assert.equal(await input.inputValue(),'')
      await page.getByRole('button',{name:'Close Add Card'}).click()
      assert.equal(await page.locator('.deckProgress').count(),0)
      assert.deepEqual(errors,[])
      console.log(`PASS ${width}px: tiles, dark holders, loan locks, borrower move, named history, retry, stale search, printing choice, stable panel, no page errors`)
    }
  } finally {await browser.close();await server.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
