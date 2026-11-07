import type { Metadata } from 'next';
import { signIn } from './actions';

export const metadata: Metadata = { title: 'Staff sign-in' };

export default async function StaffLoginPage({ searchParams }: PageProps<'/staff-login'>) {
  const { next, error } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-sm p-16 font-paypal text-pp-ink">
      <h1 className="text-[28px] font-semibold text-pp-navy">Staff sign-in</h1>
      <form action={signIn} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="next" value={typeof next === 'string' ? next : ''} />
        <label htmlFor="passcode" className="font-semibold">
          Demo passcode
        </label>
        <input
          id="passcode"
          name="passcode"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'passcode-error' : undefined}
          className="rounded border border-pp-border px-3 py-2"
        />
        {error && (
          <p id="passcode-error" role="alert" className="text-red-700">
            That passcode isn&apos;t right
          </p>
        )}
        <button className="rounded bg-pp-blue px-4 py-2 font-semibold text-white">Sign in</button>
      </form>
    </main>
  );
}
