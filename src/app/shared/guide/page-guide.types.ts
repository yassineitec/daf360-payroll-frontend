/**
 * One step of a page guide.
 *
 * `target` is the value of a `data-guide="…"` attribute placed on the element to
 * highlight. Without a target — or when the target is hidden at the current width
 * (desktop-only blocks on mobile) — the step shows centred, with nothing highlighted.
 */
export interface GuideStep {
  /** `data-guide` value of the element to highlight. */
  target?: string;
  /**
   * CSS selector of the element to highlight, for an element drawn by the library that
   * cannot carry a `data-guide` (the drawer's edge tab, the currency bubble). Wins over
   * `target`.
   */
  selector?: string;
  /** i18n key of the step title. */
  titleKey: string;
  /** i18n key of the step text. */
  textKey: string;
  /** Material Symbol shown before the title. */
  icon?: string;
  /**
   * Tab the page must show for this step (a `daf-tabs` id). The guide emits it through
   * `(tabChange)` when the step opens; the page switches, then the target is measured.
   */
  tab?: string;
}
