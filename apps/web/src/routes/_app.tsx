import { useEffect } from 'react';
import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../components/AppShell';
import { ApiError } from '../lib/api';
import { meQuery } from '../lib/queries';
import { LOCK_KEY } from '../components/AppShell';

// Everything under _app needs a session. The cookie is HttpOnly and the API is
// the source of truth, so the guard runs in the browser (ssr: false).
export const Route = createFileRoute('/_app')({ ssr: false, component: AppLayout });

function AppLayout() {
  const navigate = useNavigate();
  const { data: user, error } = useQuery(meQuery);
  const unauthorised = error instanceof ApiError && error.status === 401;
  const locked = typeof sessionStorage !== 'undefined' && !!sessionStorage.getItem(LOCK_KEY);

  useEffect(() => {
    if (unauthorised) void navigate({ to: '/login' });
    else if (locked) void navigate({ to: '/lock' });
  }, [unauthorised, locked, navigate]);

  if (!user) {
    return (
      <div className="reader-loading" style={{ position: 'fixed' }}>
        {error && !unauthorised ? 'Could not reach the API. Is it running on :8787?' : <><span className="reader-spinner" /> Loading…</>}
      </div>
    );
  }
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}
