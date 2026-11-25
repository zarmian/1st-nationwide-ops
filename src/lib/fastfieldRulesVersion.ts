/**
 * The version of the rules that decide where a FastField report goes: how
 * its times are read, how it is matched to a site, officer and activity, and
 * when it fits a shift.
 *
 * Every report stores the version it was last judged under
 * (`FastFieldReport.rulesVersion`). The robot's runs (the shift check, the
 * put-back of reports it took off, and the retry of waiting reports) judge
 * again every report stamped with a lower number, once.
 *
 * Bump this by one in the same change as any rule change. Unlike a
 * "rules changed at" time, a version can't be set earlier than the deploy by
 * mistake, so no report judged by the old code during a deploy is missed.
 *
 *   1 — 25 Nov 2026: the review fixes (typed times only everywhere, label and
 *       officer/site matching fixes, one report per activity, shift check by
 *       version).
 *   2 — 25 Nov 2026: no other time ever stands in for a typed one — not the
 *       phone's opened / finished times, not the send time. A report with no
 *       usable typed time waits for a person.
 *   3 — 25 Nov 2026: typed dates and times are read in every format FastField
 *       may send (US month-first dates, month names, timestamps, a date and a
 *       time kept apart), a date that reads both ways settled by when it was
 *       sent.
 */
export const FASTFIELD_RULES_VERSION = 3;
