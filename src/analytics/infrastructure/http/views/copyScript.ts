import { createHash } from 'node:crypto';
import { html, raw } from './escapeHtml.ts';
import type { SafeHtml } from './escapeHtml.ts';

/**
 * The entire body of the one inline `<script>` this dashboard ever emits: the
 * copy-button click handler for the tracking snippet (see
 * `renderTrackingSnippet` in `components.ts`). Kept as a single exported
 * string constant, never assembled from template pieces or duplicated
 * elsewhere, so that `COPY_BUTTON_SCRIPT_SHA256` below and the bytes actually
 * rendered between `<script>` and `</script>` (via `renderCopyButtonScript`)
 * can never drift apart — both are derived from this exact same value.
 *
 * Deliberately tiny and dependency-free: it only selects/copies the snippet
 * text and toggles a "copied" confirmation that is already localised in the
 * markup. Never `eval`, never `innerHTML`, never a network request.
 */
export const COPY_BUTTON_SCRIPT_SOURCE = `document.addEventListener('click', function (event) {
  var button = event.target.closest('.copy-button');
  if (!button) return;
  var targetId = button.getAttribute('data-copy-target');
  var target = targetId ? document.getElementById(targetId) : null;
  if (!target) return;
  var text = target.textContent || '';
  var announceCopied = function () {
    var feedback = button.parentElement ? button.parentElement.querySelector('.copy-feedback') : null;
    if (!feedback) return;
    feedback.textContent = button.getAttribute('data-copied-text') || '';
    feedback.hidden = false;
    setTimeout(function () { feedback.hidden = true; }, 2000);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(announceCopied, function () {});
    return;
  }
  var range = document.createRange();
  range.selectNodeContents(target);
  var selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
  try {
    document.execCommand('copy');
  } catch (error) {
    // Clipboard access denied or unsupported: the text stays selected, so the
    // operator can still copy it with the keyboard.
  }
  selection.removeAllRanges();
  announceCopied();
});
`;

/**
 * base64 SHA-256 of `COPY_BUTTON_SCRIPT_SOURCE`, computed once at module load
 * — never hand-written — for use in a CSP `script-src 'sha256-...'`
 * directive (see `dashboardRoutes.ts`). Hashing the exported source constant
 * directly, rather than a separately maintained copy of the script text, is
 * what keeps the CSP header and the rendered `<script>` byte-identical.
 */
export const COPY_BUTTON_SCRIPT_SHA256: string = createHash('sha256').update(COPY_BUTTON_SCRIPT_SOURCE).digest('base64');

/**
 * Renders the one inline `<script>` tag this dashboard emits, with nothing —
 * no whitespace, no other characters — between the tags and
 * `COPY_BUTTON_SCRIPT_SOURCE`: exactly the bytes hashed into
 * `COPY_BUTTON_SCRIPT_SHA256` above. `raw()` is safe here only because the
 * source is the fixed literal constant above, never attacker-controllable
 * data (see the warning on `raw()` in `escapeHtml.ts`).
 */
export function renderCopyButtonScript(): SafeHtml {
  return html`<script>${raw(COPY_BUTTON_SCRIPT_SOURCE)}</script>`;
}
