import { hashSecret } from '../packages/api/src/admin/crypto.ts';

const username = process.argv[2];
if (!username || !/^[A-Za-z0-9._@-]{1,64}$/.test(username)) {
  console.error('Usage: pnpm admin:hash <username>   (then type the password and press Enter)');
  process.exit(1);
}
if (process.stdin.isTTY) process.stderr.write(`Password for ${username} (12+ characters, not echoed by most terminals if you paste): `);
let input = '';
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (process.stdin.isTTY && input.includes('\n')) break;
}
const password = input.replace(/\r?\n$/, '');
if (password.length < 12) {
  console.error('\nThe password must be at least 12 characters.');
  process.exit(1);
}
const entry = { username, passwordHash: await hashSecret(password) };
console.log(`\n${JSON.stringify(entry)}`);
console.error('\nAdd this object to the ADMIN_USERS JSON list.');
process.exit(0);
