import '../../console/src/styles.css';
import '../dashboard/admin.css';

// The sign-in page is its own bundle: the dashboard's code is served only after sign-in.
const form = document.getElementById('signin') as HTMLFormElement;
const error = form.querySelector<HTMLElement>('[role="alert"]')!;
const button = form.querySelector('button')!;
const headers = { 'content-type': 'application/json', 'x-gaskiya-admin': '1' };

void fetch('/v1/admin/session', { headers }).then((r) => {
  if (r.ok) window.location.replace('/admin/');
}).catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    const res = await fetch('/v1/admin/session', {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: String(data.get('username') ?? '').trim(), password: String(data.get('password') ?? '') }),
    });
    if (res.ok) {
      window.location.replace('/admin/');
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    error.textContent = res.status === 404 ? 'The admin dashboard is switched off on this server: set ADMIN_USERS (or ADMIN_PASSWORD locally).' : (body.message ?? `Sign-in failed (${res.status})`);
  } catch {
    error.textContent = 'The registry cannot be reached';
  }
  (form.elements.namedItem('password') as HTMLInputElement).value = '';
  error.hidden = false;
  button.disabled = false;
  button.textContent = 'Sign in';
});
