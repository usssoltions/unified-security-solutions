/**
 * Canonical user display-name utility.
 *
 * Resolution order:
 *   1. explicitly configured display_name (if non-empty and not an email)
 *   2. Base44 profile full_name
 *   3. first_name + last_name (if both present)
 *   4. email local-part (final emergency fallback)
 *
 * Use this EVERYWHERE a user's name is rendered or stored as a snapshot.
 * Never use `user.full_name` or `user.display_name` directly in JSX.
 */

/**
 * Returns the best available human-readable display name for a user object.
 * @param {object|null|undefined} user
 * @returns {string}
 */
export function getUserDisplayName(user) {
  if (!user) return "Unknown User";

  // 1. Explicit display_name — but not if it's just an email
  const dn = user.display_name?.trim();
  if (dn && !dn.includes("@")) return dn;

  // 2. Base44 profile full_name
  const fn = user.full_name?.trim();
  if (fn && !fn.includes("@")) return fn;

  // 3. first_name + last_name
  const first = user.first_name?.trim();
  const last = user.last_name?.trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;

  // 4. Email local-part (strip @domain)
  if (user.email) {
    const local = user.email.split("@")[0];
    if (local) return local.charAt(0).toUpperCase() + local.slice(1);
  }

  return "Unknown User";
}

/**
 * Returns just the first initial (uppercase) for avatar circles.
 */
export function getUserInitial(user) {
  const name = getUserDisplayName(user);
  return name?.[0]?.toUpperCase() || "U";
}

/**
 * Returns the email local-part ONLY when no real profile name exists.
 * Useful for secondary/badge display where you want to show the account
 * identifier without revealing the full email in some contexts.
 */
export function getUserEmailLocal(user) {
  if (!user?.email) return "";
  return user.email.split("@")[0] || "";
}