import { fmtMoney } from '../utils/format.ts'

interface Props {
  label: string
  value: number
  onChange: (v: number) => void
  suffix?: string
  step?: number
  hint?: string
}

export function NumberField({ label, value, onChange, suffix, step = 1, hint }: Props) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
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
