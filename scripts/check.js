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

function assertNoHardcodedDatabaseUrl(relativePath) {
  const source = readFile(relativePath);
  if (/postgres(?:ql)?:\/\//i.test(source) || /neon\.tech/i.test(source)) {
    throw new Error(`Hardcoded database URL detected in ${relativePath}`);
  }
  console.log(`OK No hardcoded database URL: ${relativePath}`);
}

function assertRenderBlueprintUsesSecretPrompt() {
  const renderYaml = readFile('render.yaml');
  if (!/key:\s*DATABASE_URL[\s\S]*?sync:\s*false/.test(renderYaml)) {
    throw new Error('render.yaml must keep DATABASE_URL as sync: false');
  }
  console.log('OK Render DATABASE_URL uses sync: false');
}

try {
  jsFiles.forEach(compileJavaScript);
  ['server.js', 'render.yaml'].forEach(assertNoHardcodedDatabaseUrl);
  assertRenderBlueprintUsesSecretPrompt();
  console.log('All checks passed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
