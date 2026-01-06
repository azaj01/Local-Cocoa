require('dotenv').config();
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const appName = 'Local Cocoa.app';
const appPath = path.resolve(__dirname, '../release/mac-arm64', appName);
const zipPath = path.resolve(__dirname, '../release/mac-arm64', 'Local Cocoa.zip');

if (!fs.existsSync(appPath)) {
    console.error(`App not found at ${appPath}`);
    process.exit(1);
}

console.log('1. Zipping app for notarization...');
try {
    // Create a zip file preserving permissions and parent directory
    execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`);
    console.log(`   Created ${zipPath}`);
} catch (e) {
    console.error('Failed to zip app:', e);
    process.exit(1);
}

console.log('2. Submitting to Apple (raw command)...');
const args = [
    'notarytool',
    'submit',
    zipPath,
    '--apple-id', process.env.APPLE_ID,
    '--password', process.env.APPLE_ID_PASSWORD,
    '--team-id', process.env.APPLE_TEAM_ID,
    '--wait'
];

console.log(`   Running: xcrun ${args.join(' ')}`);

const child = spawn('xcrun', args);

child.stdout.on('data', (data) => process.stdout.write(data));
child.stderr.on('data', (data) => process.stderr.write(data));

child.on('close', (code) => {
    console.log(`\nProcess exited with code ${code}`);
    // Cleanup zip
    if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
    }
});
