#!/bin/bash

# Load .env file if it exists
if [ -f .env ]; then
    echo "📄 Loading environment variables from .env..."
    set -a
    source .env
    set +a
else
    echo "❌ Error: .env file not found."
    exit 1
fi

# Check for required environment variables
if [ -z "$APPLE_ID" ] || [ -z "$APPLE_ID_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
    echo "❌ Error: Missing Apple credentials in .env file."
    echo "Required: APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID"
    exit 1
fi

if [ -z "$1" ]; then
    echo "🔍 Checking notarization history (last 10 items)..."
    xcrun notarytool history \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_ID_PASSWORD" \
        --team-id "$APPLE_TEAM_ID"
else
    echo "🔍 Checking log for submission ID: $1"
    xcrun notarytool log "$1" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_ID_PASSWORD" \
        --team-id "$APPLE_TEAM_ID"
fi
