import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorState } from './states';
import { ApiError } from '@/api/client';

describe('ErrorState (§8)', () => {
  it('renders the backend message and code', () => {
    const error = new ApiError({
      status: 401,
      message: 'Invalid API key.',
      code: 'invalid_api_key',
      type: 'invalid_request_error',
    });
    render(<ErrorState title="Unable to load forecast" error={error} />);
    expect(screen.getByText('Unable to load forecast')).toBeInTheDocument();
    expect(screen.getByText('Invalid API key.')).toBeInTheDocument();
    expect(screen.getByText('code: invalid_api_key')).toBeInTheDocument();
  });

  it('shows access denied for forbidden scope (§3/§10)', () => {
    const error = new ApiError({
      status: 403,
      message: 'You do not have access to this consumer scope.',
      code: 'forbidden_scope',
      param: 'consumer',
    });
    render(<ErrorState error={error} />);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.getByText('code: forbidden_scope')).toBeInTheDocument();
  });

  it('falls back gracefully for non-API errors', () => {
    render(<ErrorState error={new Error('boom')} />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
