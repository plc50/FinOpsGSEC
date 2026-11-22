import { describe, expect, it } from 'vitest';
import { mockFetch } from './mocks';

function auth(key: string): RequestInit {
  return { headers: { Authorization: `Bearer ${key}` } };
}

describe('mock backend — auth & scope (§3/§10)', () => {
  it('rejects requests without an API key', async () => {
    const res = await mockFetch('/dashboard/me');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('missing_api_key');
  });

  it('rejects invalid API keys', async () => {
    const res = await mockFetch('/dashboard/me', auth('nope'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_api_key');
  });

  it('returns role from /dashboard/me', async () => {
    const consumer = await (
      await mockFetch('/dashboard/me', auth('finops_key_marketing'))
    ).json();
    expect(consumer.role).toBe('consumer');
    expect(consumer.consumer).toBe('equipo-marketing');

    const admin = await (
      await mockFetch('/dashboard/me', auth('finops_key_admin'))
    ).json();
    expect(admin.role).toBe('admin');
    expect(admin.visible_consumers.length).toBeGreaterThan(1);
  });

  it('forbids a consumer from accessing another consumer forecast', async () => {
    const res = await mockFetch(
      '/dashboard/forecast/equipo-producto',
      auth('finops_key_marketing'),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('forbidden_scope');
  });

  it('allows admin to access any consumer forecast', async () => {
    const res = await mockFetch(
      '/dashboard/forecast/equipo-producto',
      auth('finops_key_admin'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.consumer).toBe('equipo-producto');
    expect(Array.isArray(body.series)).toBe(true);
  });

  it('blocks budget mutation for consumers', async () => {
    const res = await mockFetch('/dashboard/budgets/equipo-marketing', {
      method: 'POST',
      headers: { Authorization: 'Bearer finops_key_marketing' },
      body: JSON.stringify({ budget: 20, warning_threshold: 0.8 }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('forbidden_scope');
  });

  it('validates budget updates for admin', async () => {
    const res = await mockFetch('/dashboard/budgets/equipo-marketing', {
      method: 'POST',
      headers: { Authorization: 'Bearer finops_key_admin' },
      body: JSON.stringify({ budget: -5, warning_threshold: 0.8 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('validation_error');
  });
});
