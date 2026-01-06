const path = require('path');
const { app } = require('electron');
const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');

const rootDir = path.resolve(__dirname, '..');

// Load .env configuration
dotenvExpand.expand(dotenv.config({ path: path.join(rootDir, 'config', `.env`) }));
dotenvExpand.expand(dotenv.config({ path: path.join(rootDir, 'config', `.env.dev`) }));
// Environment variables will be loaded by loadEnvironment() in main.ts
// This entry point only handles ts-node setup for dev mode

if (process.platform === 'darwin') {
    app.setName('Local Cocoa');
}

process.env.TS_NODE_PROJECT = path.join(rootDir, 'src', 'main', 'tsconfig.json');
require('ts-node/register/transpile-only');
require('../src/main/main.ts');
