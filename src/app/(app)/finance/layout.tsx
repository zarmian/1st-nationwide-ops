import { FinanceNav } from "@/components/FinanceNav";

/**
 * Finance section shell. Renders the sub-nav once above every finance page, so
 * each page's header is free for page-specific actions rather than a stack of
 * navigation buttons. The band sits under a hairline that doubles as the scroll
 * edge where the tabs overflow on narrow screens.
 */
export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-5 border-b border-slate-200/70 pb-2">
        <FinanceNav />
      </div>
      {children}
    </div>
  );
}
