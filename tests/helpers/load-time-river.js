const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTimeRiver(pathname = '/') {
  const source = fs.readFileSync(path.join(process.cwd(), 'public', 'shared.js'), 'utf8');
  const context = {
    window: {
      location: { pathname },
    },
  };

  vm.runInNewContext(source, context, { filename: 'public/shared.js' });
  return context.window.TimeRiver;
}

module.exports = { loadTimeRiver };
