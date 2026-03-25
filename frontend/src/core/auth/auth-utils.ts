export interface AuthProfile {
  name: string;
  email?: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function isStrongPasscode(passcode: string): boolean {
  return passcode.trim().length >= 6;
}

export function hashPasscode(passcode: string): string {
  // Local auth only; this is not a server-grade password hash.
  return btoa(unescape(encodeURIComponent(passcode)));
}

export function verifyPasscode(passcode: string, hash: string): boolean {
  if (!hash) return false;
  return hashPasscode(passcode) === hash;
}
