/**
 * Utilities for importing legacy (pre-v4 launcher) StarMade installations.
 */

/**
 * Parse the version string out of the contents of a StarMade `version.txt` file.
 * The file format is `<version>#<buildDate>` (e.g. `0.205.1#20260311_181557`).
 * Returns the version portion before `#`, or `null` if the content is not valid.
 */
export function parseVersionTxt(content: string): string | null {
  const trimmed = content.trim();
  const hashIdx = trimmed.indexOf('#');
  if (hashIdx < 0) return null;
  const version = trimmed.substring(0, hashIdx).trim();
  return version || null;
}
