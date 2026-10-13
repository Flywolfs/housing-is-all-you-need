import type { Derived } from '../types.ts'
import type { Inputs } from '../types.ts'
import { fmtMoney, fmtSignedWan, fmtWan } from '../utils/format.ts'

export function Summary({ result, inputs }: { result: { derived: Derived; warnings: string[] }; inputs: Inputs }) {
  const { derived: d, warnings } = result
  const buyWins = d.finalDiff > 0
  const cash = inputs.cashFollowUpfront ? d.upfrontBuy : inputs.initialCash
  const shortfall = d.upfrontBuy - cash

  return (
    <div className="summary">
      {shortfall > 0 && (
        <div className="afford-warning">
          <b>资金不足，该方案当前无法完成交易：</b>
          期初总支出 {fmtMoney(d.upfrontBuy)} 超过手头现金 {fmtMoney(cash)}，缺口{' '}
          {fmtMoney(shortfall)}。可降低首付比例（增加贷款）、调低楼价或减少装修等期初支出。
        </div>
      )}
      <div className={`verdict ${buyWins ? 'verdict-buy' : 'verdict-rent'}`}>
        <span className="verdict-tag">{buyWins ? '买房更优' : '租房更优'}</span>
        <span className="verdict-text">
          {inputs.years} 年末净资产：买 {fmtWan(d.finalBuy)} vs 租 {fmtWan(d.finalRent)}，{buyWins ? '买房' : '租房'} 多{' '}
          <b>{fmtSignedWan(Math.abs(d.finalDiff))}</b>
        </span>
        <span className="verdict-sub">
          {d.breakEvenYear === null
            ? `模拟期内${buyWins ? '买房' : '租房'}全程领先`
            : `第 ${d.breakEvenYear} 年起买房净资产首次反超租房`}
        </span>
      </div>

      <div className="metrics">
        <div className="metric">
          <span className="metric-label">贷款额（LTV {d.ltvPct.toFixed(0)}%）</span>
          <span className="metric-value">{fmtMoney(d.loanAmount)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">首年月供</span>
          <span className="metric-value">{fmtMoney(d.monthlyPayment0)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">DSR（月供/收入）</span>
          <span className={`metric-value ${d.dsrPct > 50 ? 'bad' : ''}`}>{d.dsrPct.toFixed(0)}%</span>
        </div>
        <div className="metric">
          <span className="metric-label">印花税</span>
          <span className="metric-value">{fmtMoney(d.stampDuty)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">按保保费</span>
          <span className="metric-value">{d.mipEligible ? fmtMoney(d.mipPremium) : '—'}</span>
        </div>
        <div className="metric">
          <span className="metric-label">期初总支出</span>
          <span className={`metric-value ${shortfall > 0 ? 'bad' : ''}`}>{fmtMoney(d.upfrontBuy)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">手头现金（第 0 年）</span>
          <span className={`metric-value ${shortfall > 0 ? 'bad' : ''}`}>{fmtMoney(cash)}</span>
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
