const { generateKeyPairSync, createHash } = require('crypto');
const fs = require('fs');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
const key = der.toString('base64');
const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
const id = [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
fs.writeFileSync('tools/extension-key.json', JSON.stringify({
  key,
  id,
  privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
}, null, 2));
console.log('EXTENSION_ID=' + id);
