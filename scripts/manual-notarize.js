require('dotenv').config();
const { notarize } = require('@electron/notarize');
const path = require('path');
const fs = require('fs');

const { execSync } = require('child_process');

async function run() {
    // Default to the DMG file now, as we are notarizing post-build
    const dmgName = 'Local Cocoa-0.1.0-arm64.dmg';
    const defaultPath = path.resolve(__dirname, '../release', dmgName);

    // Allow passing a custom path as an argument
    const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultPath;

    if (!fs.existsSync(targetPath)) {
        console.error(`Error: File not found at ${targetPath}`);
        console.error('Usage: node scripts/manual-notarize.js [path/to/dmg]');
        process.exit(1);
    } if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD || !process.env.APPLE_TEAM_ID) {
        console.error('Error: Missing environment variables. Please check .env file.');
        console.error('Required: APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID');
        process.exit(1);
    }

    console.log('Starting manual notarization...');
    console.log(`  - Target: ${targetPath}`);
    console.log(`  - Apple ID: ${process.env.APPLE_ID}`);
    console.log(`  - Team ID: ${process.env.APPLE_TEAM_ID}`);
    console.log('  - Tool: notarytool');

    // Check if the DMG is signed
    try {
        console.log('\nChecking if DMG is signed...');
        execSync(`codesign --verify --deep --strict "${targetPath}"`, { stdio: 'ignore' });
        console.log('  ✅ DMG is already signed.');
    } catch (e) {
        console.log('  ⚠️ DMG is NOT signed. Attempting to sign it now...');
        try {
            // Find the identity hash
            const identities = execSync('security find-identity -v -p codesigning').toString();
            const match = identities.match(/"Developer ID Application: .* \((.*)\)"/);
            let identity = null;

            if (match && match[1] === process.env.APPLE_TEAM_ID) {
                // Extract the hash from the line
                const line = identities.split('\n').find(l => l.includes(process.env.APPLE_TEAM_ID));
                if (line) {
                    identity = line.trim().split(' ')[1]; // The hash is usually the second element
                }
            }

            if (!identity) {
                // Fallback: try to sign with the name constructed from Team ID if we can't parse hash
                // But we don't know the name. Let's try to find any valid identity with the Team ID.
                const lines = identities.split('\n');
                for (const line of lines) {
                    if (line.includes(process.env.APPLE_TEAM_ID)) {
                        identity = line.trim().split(' ')[1];
                        break;
                    }
                }
            }

            if (!identity) {
                throw new Error(`Could not find a valid Developer ID Application certificate for Team ID ${process.env.APPLE_TEAM_ID}`);
            }

            console.log(`  - Signing with identity: ${identity}`);
            execSync(`codesign --force --sign "${identity}" "${targetPath}"`, { stdio: 'inherit' });
            console.log('  ✅ Signing successful.');
        } catch (signError) {
            console.error('  ❌ Failed to sign DMG manually:', signError.message);
            process.exit(1);
        }
    }

    console.log('\nUploading to Apple servers. This may take several minutes...');

    try {
        await notarize({
            appBundleId: 'com.local.cocoa',
            appPath: targetPath,
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_ID_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
            tool: 'notarytool',
        });
        console.log('\n✅ Notarization successful!');

        console.log('Stapling the ticket to the DMG...');
        try {
            execSync(`xcrun stapler staple "${targetPath}"`, { stdio: 'inherit' });
            console.log('\n✅ Stapling successful! The DMG is ready for distribution.');
        } catch (stapleError) {
            console.error('\n⚠️ Stapling failed (but notarization succeeded). You can try stapling manually.');
        }
    } catch (error) {
        console.error('\n❌ Notarization failed:');
        console.error(error);
        process.exit(1);
    }
}

run();
