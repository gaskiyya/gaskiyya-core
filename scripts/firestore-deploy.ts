import { readFileSync } from 'node:fs';
import { importPKCS8, SignJWT } from 'jose';

const project = process.argv[2];
const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!project || !keyFile) throw new Error('usage: GOOGLE_APPLICATION_CREDENTIALS=key.json tsx scripts/firestore-deploy.ts <project-id>');
const sa = JSON.parse(readFileSync(keyFile, 'utf8')) as { client_email: string; private_key: string };

const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/cloud-platform' })
  .setProtectedHeader({ alg: 'RS256' })
  .setIssuer(sa.client_email)
  .setSubject(sa.client_email)
  .setAudience('https://oauth2.googleapis.com/token')
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(await importPKCS8(sa.private_key, 'RS256'));
const tok = (await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) })).json()) as { access_token: string };

async function api(method: string, url: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; status?: string } };
  return { ok: r.ok, status: r.status, j };
}

const db = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`;
const cfg = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as {
  indexes: { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order: string }[] }[];
  fieldOverrides: { collectionGroup: string; fieldPath: string; ttl?: boolean; indexes: unknown[] }[];
};

let failures = 0;
console.log(`\nFirestore indexes for ${project}`);
for (const ix of cfg.indexes) {
  const r = await api('POST', `${db}/collectionGroups/${ix.collectionGroup}/indexes`, {
    queryScope: ix.queryScope,
    fields: ix.fields.map((f) => ({ fieldPath: f.fieldPath, order: f.order })),
  });
  const label = `${ix.collectionGroup} (${ix.fields.map((f) => f.fieldPath).join(', ')})`;
  if (r.ok) console.log(`  created  ${label}  (builds in the background)`);
  else if (r.status === 409) console.log(`  exists   ${label}`);
  else {
    failures++;
    console.log(`  FAILED   ${label}: ${r.status} ${r.j.error?.message}`);
  }
}

console.log('\nTTL policies (automatic expiry)');
for (const fo of cfg.fieldOverrides.filter((f) => f.ttl)) {
  const url = `${db}/collectionGroups/${fo.collectionGroup}/fields/${fo.fieldPath}?updateMask=ttlConfig,indexConfig`;
  const r = await api('PATCH', url, { ttlConfig: {}, indexConfig: { indexes: [] } });
  const label = `${fo.collectionGroup}.${fo.fieldPath}`;
  if (r.ok) console.log(`  set      ${label}`);
  else {
    failures++;
    console.log(`  FAILED   ${label}: ${r.status} ${r.j.error?.message}`);
  }
}

console.log('\nSecurity rules');
const rules = await api('POST', `https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`, {
  source: { files: [{ name: 'firestore.rules', content: readFileSync('firestore.rules', 'utf8') }] },
});
if (!rules.ok) {
  failures++;
  console.log(`  FAILED   ruleset: ${rules.status} ${rules.j.error?.message}`);
} else {
  const rulesetName = rules.j.name as string;
  const releaseName = `projects/${project}/releases/cloud.firestore`;
  let rel = await api('PATCH', `https://firebaserules.googleapis.com/v1/${releaseName}`, { release: { name: releaseName, rulesetName } });
  if (rel.status === 404) rel = await api('POST', `https://firebaserules.googleapis.com/v1/projects/${project}/releases`, { name: releaseName, rulesetName });
  if (rel.ok) console.log(`  released ${rulesetName.split('/').pop()} to cloud.firestore`);
  else {
    failures++;
    console.log(`  FAILED   release: ${rel.status} ${rel.j.error?.message}`);
  }
}

console.log(failures ? `\n${failures} step(s) failed.\n` : '\nDone.\n');
process.exitCode = failures ? 1 : 0;
