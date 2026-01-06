const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

// TODO: Currently the working directory is hardcoded, make this configurable
const workingDir = path.join(__dirname, '..');

const isWin = os.platform() === 'win32';
const script = isWin
    ? path.join(workingDir, 'scripts/win/package_local_rag.ps1')
    : path.join(workingDir, 'scripts/linux/package_local_rag.sh');

const cmd = isWin ? 'powershell' : 'bash';
const args = isWin ? ['-ExecutionPolicy', 'Bypass', '-File', script, workingDir] : [script, workingDir];

console.log(`Running packaging script: ${script}`);

const child = spawn(cmd, args, { stdio: 'inherit' });

child.on('exit', (code) => {
    process.exit(code);
});
