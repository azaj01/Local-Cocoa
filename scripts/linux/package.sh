#!/bin/bash

# Exit on error
set -e

# Function to show usage
usage() {
    echo "Usage: $0 [option]"
    echo "Options:"
    echo "  --debug    Build DMG without code signing (faster, for testing)"
    echo "  --deploy   Build DMG with code signing and notarization (for release)"
    exit 1
}

# Check if argument is provided
if [ $# -eq 0 ]; then
    usage
fi

# Handle arguments
case "$1" in
    --debug)
        echo "📦 Packaging for DEBUG (No Signing)..."
        npm run dist:dmg-debug
        ;;
    --deploy)
        echo "🚀 Packaging for DEPLOY (Signed & Notarized)..."
        
        # Load .env file if it exists to get APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID
        if [ -f .env ]; then
            echo "📄 Loading environment variables from .env..."
            set -a
            source .env
            set +a
        fi

        # Check for required environment variables for notarization
        MISSING_VARS=0
        if [ -z "$APPLE_ID" ]; then
            echo "❌ Error: APPLE_ID environment variable is missing."
            MISSING_VARS=1
        fi
        if [ -z "$APPLE_ID_PASSWORD" ]; then
            echo "❌ Error: APPLE_ID_PASSWORD environment variable is missing."
            MISSING_VARS=1
        fi
        if [ -z "$APPLE_TEAM_ID" ]; then
            echo "❌ Error: APPLE_TEAM_ID environment variable is missing."
            MISSING_VARS=1
        fi

        if [ $MISSING_VARS -eq 1 ]; then
            echo ""
            echo "To sign and notarize the app, you must export these variables:"
            echo "  export APPLE_ID=\"your-email@example.com\""
            echo "  export APPLE_ID_PASSWORD=\"your-app-specific-password\""
            echo "  export APPLE_TEAM_ID=\"YOUR_TEAM_ID\""
            echo ""
            echo "You can generate an app-specific password at appleid.apple.com"
            exit 1
        fi

        echo "✅ Apple credentials found. Proceeding with build..."
        
        # Clean previous builds to ensure we pick up the new DMG
        rm -f release/*.dmg

        # Build the DMG (Signed but not Notarized yet)
        # Note: We removed "afterSign" from package.json so this step only signs locally.
        npm run dist:dmg

        # Find the generated DMG
        DMG_FILE=$(find release -name "*.dmg" -maxdepth 1 | head -n 1)

        if [ -z "$DMG_FILE" ]; then
            echo "❌ Error: No DMG file found in release/ folder."
            exit 1
        fi

        echo "📤 Uploading $DMG_FILE to Apple for Notarization (Async)..."
        
        # Submit to Apple Notarization Service without waiting
        xcrun notarytool submit "$DMG_FILE" \
            --apple-id "$APPLE_ID" \
            --password "$APPLE_ID_PASSWORD" \
            --team-id "$APPLE_TEAM_ID" \
            --no-wait

        echo ""
        echo "✅ Upload complete! Notarization is processing in the background."
        echo "ℹ️  You can check the status later using the RequestUUID shown above."
        echo "⚠️  Note: The DMG is NOT stapled. It requires an internet connection to verify on first launch."
        ;;
    *)
        echo "❌ Invalid option: $1"
        usage
        ;;
esac

echo "✅ Done!"
