import { useState } from 'react'
import { fmtMoney } from '../utils/format.ts'

/**
 * 数字输入框：用 draft 状态保存输入中的原始文本，
 * 允许整格删除后重新输入（删除时提交 0 但显示保持空白，失焦后回落显示实际值）
 */
export function DraftNumberInput({
  value,
  onCommit,
  step,
  className,
  disabled,
}: {
  value: number
  onCommit: (v: number) => void
  step?: number | string
  className?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="number"
      step={step}
      className={className}
      disabled={disabled}
      value={draft ?? (Number.isFinite(value) ? String(value) : '0')}
      onChange={(e) => {
        const v = e.target.value
        setDraft(v)
        if (v === '' || v === '-') return // 空格/负号输入中：显示保持，等失焦或继续输入
        const n = Number(v)
        if (Number.isFinite(n)) onCommit(n)
      }}
      onBlur={() => {
        if (draft !== null && draft !== '' && draft !== '-') {
          const n = Number(draft)
          if (Number.isFinite(n)) onCommit(n)
        }
        setDraft(null)
      }}
    />
  )
}

interface Props {
  label: string
  value: number
  onChange: (v: number) => void
  suffix?: string
  step?: number
  hint?: string
  disabled?: boolean
}

export function NumberField({ label, value, onChange, suffix, step = 1, hint, disabled }: Props) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <DraftNumberInput value={value} onCommit={onChange} step={step} disabled={disabled} />
        {suffix ? <em>{suffix}</em> : null}
      </span>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function MoneyField(props: Omit<Props, 'step'> & { step?: number }) {
  const { value } = props
  return <NumberField {...props} step={props.step ?? 1000} hint={props.hint ?? (value ? fmtMoney(value) : undefined)} />
}

interface ToggleProps {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  hint?: string
}

export function ToggleField({ label, value, onChange, hint }: ToggleProps) {
  return (
    <label className="field field-toggle">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <em>{value ? '开' : '关'}</em>
      </span>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

interface SelectProps<T extends string | number> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  hint?: string
}

export function SelectField<T extends string | number>({ label, value, options, onChange, hint }: SelectProps<T>) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <select value={String(value)} onChange={(e) => {
          const raw = e.target.value
          const opt = options.find((o) => String(o.value) === raw)
          if (opt) onChange(opt.value)
        }}>
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}
