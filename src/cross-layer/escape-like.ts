/** Escape LIKE wildcards (% and _) so user input is treated literally */
export function escapeLikePattern(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}
