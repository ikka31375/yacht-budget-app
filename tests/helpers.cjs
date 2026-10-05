const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

exports.loadAccounting = () => {
  const compiledModule = { exports: {} };
  const source = fs.readFileSync('lib/accounting.ts', 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiledModule, exports: compiledModule.exports, require });
  return compiledModule.exports;
};

exports.loadPageFunctions = (names, globals) => {
  const source = fs.readFileSync('app/page.tsx', 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const home = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Home');
  const declarations = home.body.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]);
  const code = names.map(name => {
    const declaration = declarations.find(node => node.name.getText(ast) === name);
    if (!declaration) throw new Error(`Missing page function ${name}`);
    return `const ${declaration.getText(ast)};`;
  }).join('\n');
  const state = {}, alerts = [];
  const sandbox = { alert: message => alerts.push(message), ...globals };
  for (const name of source.match(/\bset[A-Z]\w*/g) || []) sandbox[name] ||= value => { state[name] = value; };
  const context = vm.createContext(sandbox);
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { state, alerts, functions: Object.fromEntries(names.map(name => [name, vm.runInContext(name, context)])) };
};
