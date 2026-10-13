const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function load(relative, overrides = {}) {
  let filename = path.resolve(__dirname, '..', relative)
  if(!fs.existsSync(filename)&&filename.endsWith(".ts"))filename+="x"
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  const localRequire = name => overrides[name] ?? (name.startsWith('.')
    ? load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), name)) + '.ts', overrides)
    : require(name))
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(localRequire,module,module.exports)
  return module.exports
}
module.exports = { load }
