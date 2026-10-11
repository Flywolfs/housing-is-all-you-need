import type { YearRow } from '../types.ts'
import { fmtMoney } from '../utils/format.ts'

/** 悬浮提示：数据来自引擎生成的 notes（各列计算过程） */
function cellProps(row: YearRow, key: string): { title?: string; className?: string } {
  const note = row.notes?.[key]
  return note ? { title: note, className: 'has-tip' } : {}
}

export function DetailTable({ rows }: { rows: YearRow[] }) {
  return (
    <div className="table-wrap">
      <p className="table-hint">悬浮任意数字可查看该金额的计算过程（用于核对模型口径）</p>
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
              <td {...cellProps(r, 'price')}>{fmtMoney(r.buyPropertyValue)}</td>
              <td {...cellProps(r, 'loan')}>{r.buySold ? '已售' : fmtMoney(r.buyLoan)}</td>
              <td {...cellProps(r, 'mortgage')}>{fmtMoney(r.buyMortgagePaid)}</td>
              <td {...cellProps(r, 'holding')}>{fmtMoney(r.buyHoldingPaid)}</td>
              <td {...cellProps(r, 'rentalIncome')}>{r.buyRentalIncome ? fmtMoney(r.buyRentalIncome) : '—'}</td>
              <td {...cellProps(r, 'buyRent')}>{r.buyRentPaid ? fmtMoney(-r.buyRentPaid) : '—'}</td>
              <td className="td-buy" {...cellProps(r, 'buyNW')}>{fmtMoney(r.buyNetWorth)}</td>
              <td {...cellProps(r, 'rentPaid')}>{fmtMoney(-r.rentPaid)}</td>
              <td {...cellProps(r, 'deposit')}>{fmtMoney(r.rentDeposit)}</td>
              <td className="td-rent" {...cellProps(r, 'rentNW')}>{fmtMoney(r.rentNetWorth)}</td>
              <td
                className={r.buyNetWorth >= r.rentNetWorth ? 'td-buy' : 'td-rent'}
                {...cellProps(r, 'diff')}
              >
                {fmtMoney(r.buyNetWorth - r.rentNetWorth)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
