require('dotenv').config();
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    if (electronPlatformName !== 'darwin') {
        return;
    }

    const appName = context.packager.appInfo.productFilename;

    // Check if we have the necessary environment variables
    if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD || !process.env.APPLE_TEAM_ID) {
        console.log('Skipping notarization: APPLE_ID, APPLE_ID_PASSWORD, or APPLE_TEAM_ID not set in environment.');
        return;
    }

    console.log(`Notarizing ${appName} with Apple ID ${process.env.APPLE_ID}...`);
    console.log(`  - App Path: ${appOutDir}/${appName}.app`);
    console.log('  - Uploading to Apple servers...');
    console.log('  - Waiting for Apple to process (this usually takes 2-10 minutes)...');

    try {
        await notarize({
            appBundleId: 'com.local.cocoa',
            appPath: `${appOutDir}/${appName}.app`,
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_ID_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
            tool: 'notarytool',
        });
    } catch (error) {
        console.error('Notarization failed:', error);
        throw error;
    }

    console.log('  - Notarization successful!');
};