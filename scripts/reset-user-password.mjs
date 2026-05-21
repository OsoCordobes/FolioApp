#!/usr/bin/env node
/**
 * scripts/reset-user-password.mjs
 *
 * One-shot admin tool: set a new password for an existing auth.user.
 *
 * Use cases:
 *   - Founder locked out of own account.
 *   - QA seed user password rotation.
 *   - Recovering an account whose original signup used a mismatched password
 *     between the /login and /onboarding-step1 flows (the bug fixed in this
 *     commit; pre-fix accounts may have orphaned passwords).
 *
 * Usage:
 *   node --env-file=.env.local scripts/reset-user-password.mjs \
 *     <email> <new-password>
 *
 * Or with envs:
 *   RESET_EMAIL=foo@bar.com RESET_PW='secret123' \
 *     node --env-file=.env.local scripts/reset-user-password.mjs
 *
 * The script uses Supabase service-role to call auth.admin.updateUserById.
 * No email is sent; password is set immediately. Existing sessions for the
 * user are NOT revoked — sign out then sign in with the new password.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

const email = process.argv[2] || process.env.RESET_EMAIL;
const newPassword = process.argv[3] || process.env.RESET_PW;

if (!email || !newPassword) {
  console.error("Usage: node scripts/reset-user-password.mjs <email> <new-password>");
  console.error("   or: RESET_EMAIL=... RESET_PW=... node scripts/reset-user-password.mjs");
  process.exit(2);
}
if (newPassword.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(2);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Locate the user. We bump perPage to 1000 to cover small-scale projects; if
// you exceed that, switch to a SQL lookup against auth.users via pg.
const { data: list, error: listErr } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listErr) {
  console.error("listUsers failed:", listErr.message);
  process.exit(1);
}
const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`No user found with email ${email}.`);
  process.exit(1);
}

console.log(`Found user: id=${user.id}  created=${user.created_at}  confirmed=${!!user.email_confirmed_at}`);

const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
  password: newPassword,
  email_confirm: true,
});
if (updErr) {
  console.error("updateUserById failed:", updErr.message);
  process.exit(1);
}

console.log("OK — password updated.");
console.log(`Sign in at /login with: ${email}  +  the password you just set.`);
