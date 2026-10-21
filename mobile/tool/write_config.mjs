import { writeFileSync } from 'node:fs';

const keys = [
  'API_URL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_ANDROID_APP_ID',
  'FIREBASE_ANDROID_API_KEY',
  'FIREBASE_IOS_APP_ID',
  'FIREBASE_IOS_API_KEY',
  'FIREBASE_IOS_BUNDLE_ID',
];
const required = ['API_URL'];

const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Set ${missing.join(' and ')} in the Codemagic environment group gaskiyya_app`);
  process.exit(1);
}
const unset = keys.filter((k) => !process.env[k]);
if (unset.length) console.warn(`Not set (push notifications will be off): ${unset.join(', ')}`);

const config = Object.fromEntries(keys.map((k) => [k, process.env[k] ?? '']));
writeFileSync(new URL('../config/production.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
console.log('Wrote config/production.json');
