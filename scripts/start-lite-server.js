const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const isWin = os.platform() === 'win32';
const script = isWin 
    ? path.join(__dirname, '../start-lite-server-tiny.ps1')
    : path.join(__dirname, '../start-lite-server-tiny.sh');

const cmd = isWin ? 'powershell' : 'bash';
const args = isWin ? ['-ExecutionPolicy', 'Bypass', '-File', script] : [script];

console.log(`Starting lite server: ${script}`);

const child = spawn(cmd, args, { stdio: 'inherit' });

child.on('exit', (code) => {
    process.exit(code);
});
