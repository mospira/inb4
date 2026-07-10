export function normalizeLogin(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const withoutProtocol = trimmed.replace(/^https?:\/\/(www\.)?twitch\.tv\//, "");
  const withoutAt = withoutProtocol.replace(/^@+/, "");
  const login = withoutAt.split(/[/?#]/)[0] ?? "";

  return login.replace(/[^a-z0-9_]/g, "");
}

export function assertValidLogin(input: string): string {
  const login = normalizeLogin(input);

  if (!login) {
    throw new Error("Enter a Twitch channel login.");
  }

  if (login.length > 25) {
    throw new Error("Twitch channel logins must be 25 characters or fewer.");
  }

  return login;
}
