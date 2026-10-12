const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(relative, overrides = {}) {
  const filename = path.resolve(__dirname, '..', relative)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  const localRequire = (name) => overrides[name] ?? (name.startsWith('.')
    ? load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), name)) + '.ts', overrides)
    : require(name))
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(localRequire, module, module.exports)
  return module.exports
}

function database(tables) {
  const writes = []
  return {
    writes,
    auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
    from(table) {
      const query = {
        select() { return this }, eq() { return this }, in() { return this },
        or() { return this }, order() { return this }, limit() { return this },
        update(patch) { writes.push({ table, patch }); return this },
        then(resolve, reject) { return Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject) },
      }
      return query
    },
  }
}

test('history resolves both users and contact recipients, including returned loans', async () => {
  const db = database({
    card_transactions: [
      { id: 1, owner_id: 'me', recipient_user_id: 'friend', transaction_type: 'loan', status: 'completed', quantity: 2, card: { name: 'Sol Ring' } },
      { id: 2, owner_id: 'me', recipient_contact_id: 7, transaction_type: 'sale', status: 'completed', quantity: 1, card: [{ name: 'Counterspell' }] },
      { id: 3, owner_id: 'friend', recipient_user_id: 'me', transaction_type: 'loan', status: 'active', quantity: 1, card: { name: 'Island' } },
    ],
    profiles: [{ user_id: 'me', username: 'Sacho' }, { user_id: 'friend', username: 'Lexi' }],
    contacts: [{ id: 7, name: 'Justin' }],
  })
  const { fetchTransactionHistory } = load('src/lib/data.ts', { './supabase': { supabase: db } })
  const rows = await fetchTransactionHistory()
  assert.equal(rows[0].owner_name, 'Sacho')
  assert.equal(rows[0].recipient_name, 'Lexi')
  assert.equal(rows[1].recipient_name, 'Justin')
  assert.equal(rows[2].owner_name, 'Lexi')
})

test('active loans reject a quantity edit before writing inventory', async () => {
  const db = database({ card_transactions: [{ id: 1, status: 'active', quantity: 1 }] })
  const { updateCollectionItem } = load('src/lib/data.ts', { './supabase': { supabase: db } })
  await assert.rejects(updateCollectionItem(10, { quantity: 4 }), /loan/i)
  assert.equal(db.writes.length, 0)
})

test('condition edits remain available during a loan', async () => {
  const db = database({ card_transactions: [{ id: 1, status: 'active' }] })
  const { updateCollectionItem } = load('src/lib/data.ts', { './supabase': { supabase: db } })
  await updateCollectionItem(10, { condition: 'LP' })
  assert.deepEqual(db.writes[0].patch, { condition: 'LP' })
})

test('printing search includes printings after the first Scryfall page', async () => {
  const original = global.fetch
  const requests = []
  global.fetch = async (url) => {
    requests.push(String(url))
    return { ok: true, json: async () => requests.length === 1
      ? { data: [{ id: 'first' }], has_more: true, next_page: 'https://api.scryfall.com/cards/search?page=2' }
      : { data: [{ id: 'last' }], has_more: false } }
  }
  try {
    const { searchPrintings } = load('src/lib/scryfall.ts')
    assert.deepEqual((await searchPrintings('Island')).map(card => card.id), ['first', 'last'])
  } finally { global.fetch = original }
})
