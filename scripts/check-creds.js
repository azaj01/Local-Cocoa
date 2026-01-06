require('dotenv').config();
const { spawn } = require('child_process');

const cmd = 'xcrun';
const args = [
    'notarytool',
    'history',
    '--apple-id', process.env.APPLE_ID,
    '--password', process.env.APPLE_ID_PASSWORD,
    '--team-id', process.env.APPLE_TEAM_ID,
    '--output-format', 'json'
];

console.log(`Checking credentials for Apple ID: ${process.env.APPLE_ID}`);

const child = spawn(cmd, args);

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
    stdout += data.toString();
});

child.stderr.on('data', (data) => {
    stderr += data.toString();
});

child.on('close', (code) => {
    console.log(`notarytool exited with code ${code}`);
    if (code === 0) {
        console.log('Credentials are VALID.');
        console.log('History (first 200 chars):', stdout.substring(0, 200));
    } else {
        console.error('Credentials check FAILED.');
        console.error('STDERR:', stderr);
        console.log('STDOUT:', stdout);
    }
});
