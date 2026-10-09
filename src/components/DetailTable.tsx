import type { YearRow } from '../types.ts'
import { fmtMoney } from '../utils/format.ts'

export function DetailTable({ rows }: { rows: YearRow[] }) {
  return (
    <div className="table-wrap">
      <table className="detail">
        <thead>
          <tr>
            <th rowSpan={2}>年</th>
            <th colSpan={7} className="th-buy">买房方案</th>
            <th colSpan={3} className="th-rent">租房方案</th>
            <th rowSpan={2}>差额（买−租）</th>
          </tr>
          <tr>
            <th>楼市值</th>
            <th>剩余贷款</th>
            <th>月供(年合计)</th>
            <th>持有成本(年)</th>
            <th>净租金收入(年)</th>
            <th>租房支出(年)</th>
            <th>净资产</th>
            <th>租金支出(年)</th>
            <th>按金资产</th>
            <th>净资产</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.year}>
              <td>{r.year}</td>
              <td>{fmtMoney(r.buyPropertyValue)}</td>
              <td>{r.buySold ? '已售' : fmtMoney(r.buyLoan)}</td>
              <td>{fmtMoney(r.buyMortgagePaid)}</td>
              <td>{fmtMoney(r.buyHoldingPaid)}</td>
              <td>{r.buyRentalIncome ? fmtMoney(r.buyRentalIncome) : '—'}</td>
              <td>{r.buyRentPaid ? fmtMoney(-r.buyRentPaid) : '—'}</td>
              <td className="td-buy">{fmtMoney(r.buyNetWorth)}</td>
              <td>{fmtMoney(-r.rentPaid)}</td>
              <td>{fmtMoney(r.rentDeposit)}</td>
              <td className="td-rent">{fmtMoney(r.rentNetWorth)}</td>
              <td className={r.buyNetWorth >= r.rentNetWorth ? 'td-buy' : 'td-rent'}>
                {fmtMoney(r.buyNetWorth - r.rentNetWorth)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
