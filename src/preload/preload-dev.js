const path = require('path');

if (!process.env.TS_NODE_PROJECT) {
    process.env.TS_NODE_PROJECT = path.join(__dirname, 'tsconfig.json');
}

require('ts-node/register/transpile-only');
require('./preload.ts');
