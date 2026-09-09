/**
 * Escapes the five characters that matter for safely placing a string inside
 * HTML markup, an HTML/SVG attribute value (double- or single-quoted), or an
 * inline SVG `<text>` node. `&` is escaped FIRST and on its own so that the
 * ampersands introduced by escaping the other characters are never
 * themselves re-escaped (which would turn `<` into `&amp;lt;` instead of
 * `&lt;`).
 *
 * This is the ONLY escaping function in this codebase's views. There is no
 * separate "SVG escaping" or "attribute escaping" function: the same five
 * substitutions are correct and sufficient for HTML text, HTML attributes,
 * SVG text content and SVG attributes alike.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Marker type for a string that is already safe to place into HTML output
 * verbatim — either because it was built entirely out of literal template
 * text and other already-escaped/safe fragments (via the `html` tag), or
 * because it was explicitly asserted safe via `raw`.
 *
 * `SafeHtml` values are never constructed from attacker-controlled data
 * directly; `html` is what produces them for ordinary use.
 */
export class SafeHtml {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * Escape hatch that marks a string as pre-trusted HTML, skipping escaping
 * entirely. This must be the ONLY way to bypass `escapeHtml`.
 *
 * DANGER: calling `raw()` on a database-sourced or otherwise
 * attacker-controllable value (a stored path, referrer, custom event name,
 * event prop, etc.) reintroduces exactly the stored-XSS vulnerability this
 * module exists to prevent. Only ever call `raw()` on:
 *   - a fixed string literal written by a developer in this codebase, or
 *   - the already-escaped/safe output of another `html` template (composing
 *     one template's `SafeHtml` result into another template already
 *     happens automatically — you should rarely need to call `raw()` for
 *     that case; `html` unwraps nested `SafeHtml` values for you).
 */
export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

/** Renders one interpolated value: passes SafeHtml through raw, escapes everything else via String() + escapeHtml. */
function renderValue(value: unknown): string {
  if (value instanceof SafeHtml) {
    return value.value;
  }
  return escapeHtml(String(value));
}

/**
 * Tagged template that builds HTML/SVG markup while escaping every
 * interpolated value by default. An interpolated array is flattened: each
 * item is rendered (escaped, or passed through raw if it is itself
 * `SafeHtml`) and the results are concatenated with no separator, so
 * components can interpolate a list of already-built row fragments without
 * a manual `.join('')` that would bypass escaping.
 *
 * Use `raw()` (or interpolate the `SafeHtml` result of another `html`
 * template) for the rare pre-trusted fragment. Never interpolate a
 * database-sourced value through anything but this tag or `escapeHtml`
 * directly.
 */
export function html(strings: TemplateStringsArray, ...values: readonly unknown[]): SafeHtml {
  let result = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (Array.isArray(value)) {
      result += value.map((item) => renderValue(item)).join('');
    } else {
      result += renderValue(value);
    }
    result += strings[i + 1] ?? '';
  }
  return new SafeHtml(result);
}
