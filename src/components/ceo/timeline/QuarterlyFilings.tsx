import {useLang} from '../../../i18n';
import {druckenmillerPersonId} from './DruckenmillerHistory';

const duquesne = {
  manager: 'Duquesne Family Office LLC',
  prior: {
    period: '2026-06-30', filed: '2026-08-14',
  },
  latest: {
    period: '2026-09-30', filed: '2026-11-16',
  },
  // Same CUSIP and share class in both SEC information tables. Options and debt are excluded.
  rows: [
    {name: 'Amazon', prior: 541600, latest: 772600},
    {name: 'Beam Therapeutics', prior: 153600, latest: 699700},
    {name: 'BBB Foods', prior: 2901733, latest: 1647408},
    {name: 'ADMA Biologics', prior: 2784110, latest: 2212810},
    {name: 'Agnico Eagle Mines', prior: 0, latest: 231050},
    {name: 'Alphabet Class A', prior: 336300, latest: 0},
  ],
};

export function QuarterlyFilings({personId}: {personId: string}) {
  const {t, locale} = useLang();
  if (personId !== druckenmillerPersonId) return null;
  const {manager, prior, latest, rows} = duquesne;
  return <details className="mb-3 rounded-xl border border-slate-700 bg-slate-900/70 px-3 sm:px-4">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-slate-100 focus-visible:outline-cyan-400">
      {t('분기 공시', 'Quarterly filings')} · {manager}
    </summary>
    <div className="space-y-3 border-t border-slate-800 py-3">
      <p className="text-sm text-slate-300">{t('운용사 분기말 공개 보유 · 주요 종목 주식 수', 'Manager’s disclosed quarter-end holdings · selected share counts')}</p>
      <table className="w-full table-fixed border-collapse text-xs sm:text-sm" aria-label={t('분기별 보유 주식 수', 'Quarterly share counts')}>
        <colgroup><col/><col className="w-[29%]"/><col className="w-[29%]"/></colgroup>
        <thead>
          <tr className="border-b border-slate-700 text-slate-200">
            <th scope="col" className="py-2 pr-2 text-left align-bottom">{t('종목', 'Company')}</th>
            {[prior, latest].map(period => <th key={period.period} scope="col" className="py-2 pl-1 text-right align-bottom">
              <span className="block text-xs">{period.period}</span>
              <span className="block text-xs font-normal text-slate-400">
                <span className="block sm:inline">{t('공개', 'Filed')} </span><time className="whitespace-nowrap" dateTime={period.filed}>{period.filed}</time>
              </span>
            </th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map(row => <tr key={row.name}>
            <th scope="row" className="break-words py-2 pr-2 text-left font-medium text-slate-100">
              {row.name}
              <span className="block text-xs text-cyan-300">{row.prior === 0 ? t('신규', 'New') : row.latest === 0 ? t('목록 제외', 'No longer listed') : row.latest > row.prior ? t('확대', 'Increased') : t('축소', 'Reduced')}</span>
            </th>
            <td className="py-2 pl-1 text-right tabular-nums text-slate-300">{row.prior.toLocaleString(locale)}</td>
            <td className="py-2 pl-1 text-right font-semibold tabular-nums text-white">{row.latest.toLocaleString(locale)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </details>;
}
