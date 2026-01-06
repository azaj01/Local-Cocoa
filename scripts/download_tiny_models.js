const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

// TODO: Currently the download directory is hardcoded, make this configurable
const downloadDir = path.join(__dirname, '../runtime/local-cocoa-models/pretrained');

const isWin = os.platform() === 'win32';
const script = isWin
    ? path.join(__dirname, 'win/download_tiny_models.ps1')
    : path.join(__dirname, 'linux/download_tiny_models.sh');

const cmd = isWin ? 'powershell' : 'bash';
const args = isWin      // Last 2 are parameters to be passed into the script
    ? ['-ExecutionPolicy', 'Bypass', '-File', script, downloadDir]
    : [script, downloadDir];

console.log(`Downloading models using: ${script}`);

const child = spawn(cmd, args, { stdio: 'inherit' });

child.on('exit', (code) => {
    process.exit(code);
});
