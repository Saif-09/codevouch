/** Small glob matcher: supports **, *, ? — enough for zone path patterns. */
export function globToRegex(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += pattern[i + 2] === '/' ? 3 : 2;
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^(?:${re})$`);
}

export function globMatch(pattern: string, path: string): boolean {
  return globToRegex(pattern).test(path);
}
