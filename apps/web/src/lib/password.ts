/** Client-side password precheck. The server is authoritative (422 weak_password). */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblem(pw: string, confirm: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return 'Use at least {n} characters.';
  if (confirm !== pw) return 'The passwords do not match.';
  return null;
}
