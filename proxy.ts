// Signed-out visits to staff pages go to the passcode page. Only pages: the real guard is requireStaff() in each
// staff server action. Renter links (/r/*), the home page, the PayPal webhook and the cron are not matched.

import { NextResponse, type NextRequest } from 'next/server';
import { STAFF_COOKIE, verifyStaff } from '@/lib/staff';

export async function proxy(req: NextRequest) {
  if (await verifyStaff(req.cookies.get(STAFF_COOKIE)?.value)) return NextResponse.next();
  const login = new URL('/staff-login', req.url);
  login.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/control-room/:path*', '/disputes/:path*', '/hire/:path*', '/c/:path*'],
};
