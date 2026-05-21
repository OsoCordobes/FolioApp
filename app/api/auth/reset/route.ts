/**
 * Folio · /api/auth/reset
 *
 * Supabase password-reset emails historically pointed at this URL
 * (per requestPasswordReset's redirectTo). Pre-Phase-4 the route file
 * didn't exist → users clicked the email link and hit a 404.
 *
 * Phase 4 fix: this handler 302-redirects to the canonical reset page
 * at /reset-password, preserving the token + type query params Supabase
 * provides. New password-reset emails (post-Phase-4) point directly at
 * /reset-password (see app/(public)/login/actions.ts redirectTo update);
 * this route stays as a defensive shim for any email-in-flight from
 * before the redirectTo flip.
 */

import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/reset-password";
  return NextResponse.redirect(url, { status: 302 });
}
