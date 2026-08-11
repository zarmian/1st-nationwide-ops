import Link from "next/link";
import type { ReactNode } from "react";

export type DataTableColumn<T> = {
  /** Header label. */
  header: string;
  /** Render function for the cell value. */
  cell: (row: T) => ReactNode;
  /** Tailwind text-align hint. Defaults to left. */
  align?: "left" | "right";
  /** Hide this column at the table breakpoint (md+). Card view still shows it. */
  hideOnDesktop?: boolean;
  /** Hide this column on the card view (below md). */
  hideOnMobile?: boolean;
  /** Optional className for both <th> and <td>. */
  className?: string;
};

/**
 * Responsive list rendering:
 *   - On `md` and above: traditional table.
 *   - Below `md`: each row becomes a card, with column headers shown as
 *     labels next to their values.
 *
 * Pass `rowHref(row)` to make rows clickable to a detail page. Pass
 * `emptyState` to override the default empty state (which is a small
 * grey message).
 */
export function DataTable<T extends { id?: string | number }>(props: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey?: (row: T) => string | number;
  rowHref?: (row: T) => string | null;
  emptyState?: ReactNode;
  caption?: ReactNode;
  footer?: ReactNode;
}) {
  const { columns, rows, rowKey, rowHref, emptyState, caption, footer } = props;
  // Stable key: caller-provided, else the row id, else the positional index.
  // Never Math.random() — that gives every row a new key each render, which
  // remounts the whole list on any state change.
  const keyOf = (row: T, i: number) => rowKey?.(row) ?? row.id ?? i;
  // Long lists: let the browser skip render + layout of off-screen rows via
  // CSS content-visibility (see .cv-row / .cv-card in globals.css).
  const dense = rows.length > 50;

  if (rows.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-slate-500">
        {emptyState ?? "Nothing to show yet."}
      </div>
    );
  }

  const desktopCols = columns.filter((c) => !c.hideOnDesktop);
  const mobileCols = columns.filter((c) => !c.hideOnMobile);

  return (
    <div className="card overflow-hidden">
      {/* Desktop: real table. Uses the shared .table-default skeleton so
          every list in the app (dispatch, sites, officers …) matches the
          raw .table-default tables on /activities + /finance. */}
      <table className="table-default hidden md:table">
        {caption && (
          <caption className="px-4 py-3 text-xs text-slate-500 text-left bg-slate-50 border-b border-slate-100">
            {caption}
          </caption>
        )}
        <thead>
          <tr>
            {desktopCols.map((c, i) => (
              <th
                key={i}
                className={
                  (c.align === "right" ? "text-right" : "") +
                  (c.className ? " " + c.className : "")
                }
                scope="col"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const href = rowHref?.(row) ?? null;
            return (
              <tr
                key={keyOf(row, index)}
                className={
                  (href ? "cursor-pointer" : "") + (dense ? " cv-row" : "")
                }
              >
                {desktopCols.map((c, i) => (
                  <td
                    key={i}
                    className={
                      "align-top " +
                      (c.align === "right" ? "text-right" : "text-left") +
                      (c.className ? " " + c.className : "")
                    }
                  >
                    {href ? (
                      // Whole-row link via a wrapping anchor on the cell:
                      // pointer events still work, and middle-click /
                      // ctrl-click open in a new tab.
                      <Link
                        href={href}
                        className="block text-inherit no-underline"
                      >
                        {c.cell(row)}
                      </Link>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer && (
          <tfoot>
            <tr>
              <td
                colSpan={desktopCols.length}
                className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-100"
              >
                {footer}
              </td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* Mobile: card list */}
      <ul className="md:hidden divide-y divide-slate-100">
        {caption && (
          <li className="px-4 py-2 text-xs text-slate-500 bg-slate-50">
            {caption}
          </li>
        )}
        {rows.map((row, index) => {
          const href = rowHref?.(row) ?? null;
          const content = (
            <div className="px-4 py-3 space-y-1.5">
              {mobileCols.map((c, i) => (
                <div
                  key={i}
                  className={
                    i === 0
                      ? "text-base font-medium text-brand-navy"
                      : "flex justify-between gap-3 text-sm text-slate-700"
                  }
                >
                  {i === 0 ? (
                    c.cell(row)
                  ) : (
                    <>
                      <span className="text-slate-500 text-xs uppercase tracking-wider">
                        {c.header}
                      </span>
                      <span
                        className={
                          "min-w-0 text-right " +
                          (c.align === "right" ? "tabular-nums" : "")
                        }
                      >
                        {c.cell(row)}
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          );
          return (
            <li key={keyOf(row, index)} className={dense ? "cv-card" : undefined}>
              {href ? (
                <Link href={href} className="block hover:bg-slate-50">
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
        {footer && (
          <li className="px-4 py-2 text-xs text-slate-500 bg-slate-50">
            {footer}
          </li>
        )}
      </ul>
    </div>
  );
}
