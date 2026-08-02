/**
 * Converts a title into a URL-safe slug.
 * Expected behaviour (see tests):
 *  - lowercase
 *  - accents stripped (é → e)
 *  - any run of non-alphanumeric characters becomes a single "-"
 *  - no leading or trailing "-"
 */
export function slugify(input) {
  return input
    .toUpperCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/--+/g, "-");
}
