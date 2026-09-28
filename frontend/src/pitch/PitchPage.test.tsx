import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/App';

const ADMIN_ME = {
  api_key_id: 'key_admin',
  api_key_prefix: 'finops_key_...',
  consumer: 'admin',
  role: 'admin' as const,
  can_select_model: true,
  visible_consumers: [
    'equipo-marketing',
    'equipo-producto',
    'equipo-atencion-cliente',
  ],
};

vi.mock('@/auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    apiKey: 'finops_key_admin',
    me: ADMIN_ME,
    status: 'ready',
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
  useApiKey: () => 'finops_key_admin',
  useMe: () => ADMIN_ME,
}));

vi.mock('@/api/mocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/mocks')>();
  return { ...actual, isMockMode: () => true };
});

describe('/pitch presentation route and navigation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/pitch#slide-1');
  });

  it('renders /pitch as a presentation without dashboard chrome', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: /Every AI request is a financial decision/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Overview', { selector: 'nav a' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Slide 1 of 8')).toBeInTheDocument();
  });

  it('advances and goes back with presentation keys', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByLabelText('Slide 2 of 8')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /AI became infrastructure/i })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByLabelText('Slide 1 of 8')).toBeInTheDocument();
  });

  it('does not navigate while the presenter types in an input', () => {
    render(<App />);
    for (let step = 0; step < 3; step += 1) {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    }
    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    prompt.focus();
    fireEvent.keyDown(prompt, { key: 'ArrowRight' });
    fireEvent.keyDown(prompt, { key: ' ' });
    expect(screen.getByLabelText('Slide 4 of 8')).toBeInTheDocument();
  });

  it('synchronizes the current slide to the URL hash', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'PageDown' });
    expect(window.location.hash).toBe('#slide-2');
    fireEvent.keyDown(window, { key: 'End' });
    expect(window.location.hash).toBe('#slide-8');
    fireEvent.keyDown(window, { key: 'Home' });
    expect(window.location.hash).toBe('#slide-1');
  });

  it('restores the active slide from the hash on reload', () => {
    window.history.replaceState({}, '', '/pitch#slide-6');
    render(<App />);
    expect(screen.getByLabelText('Slide 6 of 8')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Equivalent intent/i })).toBeInTheDocument();
  });

  it('opens preflight directly from the setup query parameter', () => {
    window.history.replaceState({}, '', '/pitch?setup=1#slide-1');
    render(<App />);
    expect(screen.getByRole('dialog', { name: 'Preflight' })).toBeInTheDocument();
  });
});
