import { useState } from 'react'
import type { YearRow } from '../types.ts'
import { fmtMoney } from '../utils/format.ts'

const COL_LABEL: Record<string, string> = {
  price: '楼市值',
  loan: '剩余贷款',
  mortgage: '月供（年合计）',
  holding: '持有成本（年）',
  rentalIncome: '净租金收入（年）',
  buyRent: '租房支出（年）· 买房方案',
  buyDeposit: '按金资产 · 买房方案',
  buyNW: '净资产 · 买房方案',
  rentPaid: '租金支出（年）· 租房方案',
  deposit: '按金资产 · 租房方案',
  rentNW: '净资产 · 租房方案',
  diff: '差额（买−租）',
}

type Sel = { year: number; key: string } | null

function cellProps(row: YearRow, key: string, sel: Sel, setSel: (s: Sel) => void, extraClass?: string) {
  const hasNote = !!row.notes?.[key]
  const selected = sel?.year === row.year && sel?.key === key
  const className = `${extraClass ?? ''} ${hasNote ? 'has-tip' : ''} ${selected ? 'cell-selected' : ''}`.trim()
  return { className: className || undefined, onClick: hasNote ? () => setSel({ year: row.year, key }) : undefined }
}

export function DetailTable({ rows }: { rows: YearRow[] }) {
  const [sel, setSel] = useState<Sel>(null)
  const selRow = sel ? rows.find((r) => r.year === sel.year) : null
  const noteText = sel && selRow ? selRow.notes?.[sel.key] : null

  return (
    <div className="table-wrap">
      <p className="table-hint">
        点击表中任意数字，此处会显示它的原子化计算过程（每个数字拆到输入项或单一步骤，可逐行核对）
      </p>
      {sel && (
        <div className="calc-panel">
          <div className="calc-panel-title">
            第 {sel.year} 年 · {COL_LABEL[sel.key] ?? sel.key}
            <button type="button" className="calc-panel-close" onClick={() => setSel(null)}>
              关闭
            </button>
          </div>
          <pre className="calc-panel-body">{noteText ?? '（该单元格暂无计算说明）'}</pre>
        </div>
      )}
      <table className="detail">
        <thead>
          <tr>
            <th rowSpan={2}>年</th>
            <th colSpan={8} className="th-buy">买房方案</th>
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
            <th>按金资产</th>
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
              <td {...cellProps(r, 'price', sel, setSel)}>{fmtMoney(r.buyPropertyValue)}</td>
              <td {...cellProps(r, 'loan', sel, setSel)}>{r.buySold ? '已售' : fmtMoney(r.buyLoan)}</td>
              <td {...cellProps(r, 'mortgage', sel, setSel)}>{fmtMoney(r.buyMortgagePaid)}</td>
              <td {...cellProps(r, 'holding', sel, setSel)}>{fmtMoney(r.buyHoldingPaid)}</td>
              <td {...cellProps(r, 'rentalIncome', sel, setSel)}>{r.buyRentalIncome ? fmtMoney(r.buyRentalIncome) : '—'}</td>
              <td {...cellProps(r, 'buyRent', sel, setSel)}>{r.buyRentPaid ? fmtMoney(-r.buyRentPaid) : '—'}</td>
              <td {...cellProps(r, 'buyDeposit', sel, setSel)}>{r.buyDeposit ? fmtMoney(r.buyDeposit) : '—'}</td>
              <td {...cellProps(r, 'buyNW', sel, setSel, 'td-buy')}>{fmtMoney(r.buyNetWorth)}</td>
              <td {...cellProps(r, 'rentPaid', sel, setSel)}>{fmtMoney(-r.rentPaid)}</td>
              <td {...cellProps(r, 'deposit', sel, setSel)}>{fmtMoney(r.rentDeposit)}</td>
              <td {...cellProps(r, 'rentNW', sel, setSel, 'td-rent')}>{fmtMoney(r.rentNetWorth)}</td>
              <td
                {...cellProps(r, 'diff', sel, setSel, r.buyNetWorth >= r.rentNetWorth ? 'td-buy' : 'td-rent')}
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
