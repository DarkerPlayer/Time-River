const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const jsFiles = [
  'server.js',
  path.join('public', 'shared.js'),
  path.join('public', 'main.js'),
  path.join('public', 'history.js'),
];

function readFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function compileJavaScript(relativePath) {
  const source = readFile(relativePath);
  new Function(source);
  console.log(`OK JavaScript syntax: ${relativePath}`);
}

function assertDatabaseFallbackConfigured() {
  const source = readFile('server.js');
  if (!/DEFAULT_DATABASE_URL/.test(source) || !/process\.env\.DATABASE_URL/.test(source)) {
    throw new Error('server.js must keep DATABASE_URL env support plus the project database fallback');
  }
  console.log('OK Database env support and fallback configured');
}

function assertRenderBlueprintKeepsDatabaseKey() {
  const renderYaml = readFile('render.yaml');
  if (!/key:\s*DATABASE_URL/.test(renderYaml)) {
    throw new Error('render.yaml must keep the DATABASE_URL env var entry');
  }
  console.log('OK Render DATABASE_URL entry present');
}

try {
  jsFiles.forEach(compileJavaScript);
  assertDatabaseFallbackConfigured();
  assertRenderBlueprintKeepsDatabaseKey();
  console.log('All checks passed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
