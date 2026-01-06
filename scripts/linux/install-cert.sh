#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <path-to-downloaded-cer>"
  exit 1
fi

CER_FILE=$1
KEY_FILE="local_cocoa.key"
P12_FILE="local_cocoa.p12"

if [ ! -f "$KEY_FILE" ]; then
  echo "Error: $KEY_FILE not found. Did you run generate-csr.sh?"
  exit 1
fi

echo "Converting .cer and .key to .p12..."
openssl x509 -inform DER -in "$CER_FILE" -out "$CER_FILE.pem"
# OpenSSL 3 defaults to algorithms that macOS Keychain doesn't like. Use -legacy.
openssl pkcs12 -export -legacy -inkey "$KEY_FILE" -in "$CER_FILE.pem" -out "$P12_FILE" -name "Local Cocoa ID" -passout pass:password

echo "Importing to Keychain..."
security import "$P12_FILE" -k ~/Library/Keychains/login.keychain-db -P password -T /usr/bin/codesign

echo "Done! Verifying identity..."
security find-identity -v -p codesigning
