#!/bin/sh
# Create a self-signed code signing certificate "OZdash Local Signing" in the
# login keychain (once). build-mac.sh signs OZdash with it, so the app keeps the
# same signature across builds and macOS stops asking for keychain access.
# The certificate is not trusted by Apple; it is only for this Mac.
set -eu
NAME="OZdash Local Signing"
if security find-certificate -c "$NAME" >/dev/null 2>&1; then
  echo "Already exists: $NAME"; exit 0
fi
DIR="$(mktemp -d)"; trap 'rm -rf "$DIR"' EXIT
cat > "$DIR/cfg" <<CFG
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CFG
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$DIR/key.pem" -out "$DIR/cert.pem" -days 3650 -config "$DIR/cfg"
PASS="$(openssl rand -hex 16)"
openssl pkcs12 -export -legacy -inkey "$DIR/key.pem" -in "$DIR/cert.pem" -name "$NAME" -out "$DIR/id.p12" -passout "pass:$PASS"
security import "$DIR/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$PASS" -T /usr/bin/codesign
echo "Created: $NAME"
