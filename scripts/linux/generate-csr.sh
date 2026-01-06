#!/bin/bash
set -e

# 1. Generate Private Key
openssl genrsa -out local_cocoa.key 2048

# 2. Generate CSR
# Note: Adjust the subject as needed or let the user fill it in interactively if run manually.
# For automation, we'll use a generic subject, but Apple ignores most of it except the Key.
# However, it's better to be descriptive.
openssl req -new -key local_cocoa.key -out local_cocoa.csr -subj "/emailAddress=jingkang@synvo.ai/CN=Local Cocoa/C=US"

echo "----------------------------------------------------------------"
echo "CSR generated: local_cocoa.csr"
echo "Private Key generated: local_cocoa.key"
echo "----------------------------------------------------------------"
echo "1. Go to https://developer.apple.com/account/resources/certificates/add"
echo "2. Choose 'Developer ID Application'"
echo "3. Upload 'local_cocoa.csr'"
echo "4. Download the certificate (e.g., developerID_application.cer)"
echo "5. Place the .cer file in this directory."
echo "6. Run: ./scripts/install-cert.sh developerID_application.cer"
