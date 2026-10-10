import type { Derived, Inputs } from '../types.ts'
import { DEFAULT_INPUTS, MAX_YEARS } from '../engine/defaults.ts'
import { HK_HISTORY, HK_HISTORY_PRICE_YEARS, HK_HISTORY_RENT_YEARS } from '../data/hkHistory.ts'
import { MoneyField, NumberField, SelectField, ToggleField } from './fields.tsx'
import { RateListEditor } from './RateListEditor.tsx'
import { fmtMoney } from '../utils/format.ts'

type Setter = <K extends keyof Inputs>(key: K, value: Inputs[K]) => void

function Group({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="group" open={open}>
      <summary>{title}</summary>
      <div className="group-body">{children}</div>
    </details>
  )
}

export function InputPanel({ inputs, set, derived }: { inputs: Inputs; set: Setter; derived: Derived }) {
  const T = inputs.years
  const sellYearOptions = [
    { value: 0, label: '不出售（持有到期末）' },
    ...Array.from({ length: T }, (_, i) => ({ value: i + 1, label: `第 ${i + 1} 年末出售` })),
  ]

  return (
    <div className="input-panel">
      <Group title="一、基本设定" open>
        <div className="field-row">
          <NumberField label="模拟时长" value={inputs.years} suffix="年"
            onChange={(v) => set('years', Math.min(MAX_YEARS, Math.max(1, Math.round(v || 1))))} />
          <MoneyField label="楼价现价" value={inputs.propertyPrice} onChange={(v) => set('propertyPrice', v)} />
        </div>
        <div className="field-row">
          <MoneyField
            label="手头现金（第 0 年）"
            value={inputs.initialCash}
            onChange={(v) => set('initialCash', v)}
            hint={`期初总支出约 ${fmtMoney(derived.upfrontBuy)}（首付+税费+佣金+律师+按保+装修）`}
          />
        </div>
        <div className="field-block">
          <div className="block-title">楼价增长率列表（% / 每年）</div>
          <RateListEditor
            values={inputs.priceGrowthRates}
            count={T}
            onChange={(v) => set('priceGrowthRates', v)}
            kind="growth"
            history={{ label: 'RVD 楼价指数', years: HK_HISTORY_PRICE_YEARS, yoy: HK_HISTORY.priceYoy }}
          />
        </div>
        <div className="field-row">
          <SelectField
            label="中途出售"
            value={inputs.sellYear ?? 0}
            options={sellYearOptions}
            onChange={(v) => set('sellYear', v === 0 ? null : v)}
          />
          {inputs.sellYear !== null && (
            <NumberField
              label="出售价（留 0 = 按曲线推算）"
              value={inputs.salePriceOverride ?? 0}
              suffix="$"
              step={100_000}
              hint={
                inputs.salePriceOverride
                  ? fmtMoney(inputs.salePriceOverride)
                  : `推算值 ${fmtMoney(derived.salePriceDefault ?? 0)}`
              }
              onChange={(v) => set('salePriceOverride', v === 0 ? null : v)}
            />
          )}
        </div>
      </Group>

      <Group title="二、买房 · 交易成本">
        <div className="field-row">
          <NumberField label="首付比例" value={inputs.downPaymentPct} suffix="%" step={5}
            onChange={(v) => set('downPaymentPct', Math.min(100, Math.max(0, v)))} />
          <NumberField label="代理佣金" value={inputs.agencyFeePct} suffix="%" step={0.25}
            onChange={(v) => set('agencyFeePct', v)} />
        </div>
        <div className="field-row">
          <MoneyField label="律师费（买卖）" value={inputs.legalFeeBuy} onChange={(v) => set('legalFeeBuy', v)} />
          <MoneyField label="律师费（按揭）" value={inputs.legalFeeMortgage} onChange={(v) => set('legalFeeMortgage', v)} />
        </div>
        <div className="field-row">
          <MoneyField label="政府注册杂费" value={inputs.miscFees} onChange={(v) => set('miscFees', v)} />
          <MoneyField label="装修 / 家电家具" value={inputs.renovation} onChange={(v) => set('renovation', v)} />
        </div>
        <div className="field-row">
          <NumberField
            label="印花税覆盖（0 = 自动按税表）"
            value={inputs.stampDutyOverride ?? 0}
            suffix="$"
            step={10_000}
            onChange={(v) => set('stampDutyOverride', v === 0 ? null : v)}
          />
          <NumberField
            label="按保保费覆盖（0 = 自动）"
            value={inputs.mipOverride ?? 0}
            suffix="$"
            step={10_000}
            onChange={(v) => set('mipOverride', v === 0 ? null : v)}
          />
        </div>
      </Group>

      <Group title="三、买房 · 按揭">
        <div className="field-row">
          <NumberField label="还款期" value={inputs.loanYears} suffix="年"
            onChange={(v) => set('loanYears', Math.min(30, Math.max(1, Math.round(v || 1))))} />
          <NumberField label="封顶利率" value={inputs.capRate} suffix="%" step={0.125} onChange={(v) => set('capRate', v)} />
        </div>
        <div className="field-block">
          <div className="block-title">按揭利率列表（% / 每年）</div>
          <RateListEditor
            values={inputs.mortgageRates}
            count={Math.max(T, inputs.loanYears)}
            onChange={(v) => set('mortgageRates', v)}
            kind="rate"
            fillCapRate={inputs.capRate}
          />
        </div>
        <div className="field-row">
          <NumberField label="现金回赠" value={inputs.cashRebatePct} suffix="% 贷款额" step={0.1}
            onChange={(v) => set('cashRebatePct', v)} />
          <NumberField label="罚息/回赠锁定期" value={inputs.lockInYears} suffix="年"
            onChange={(v) => set('lockInYears', Math.max(0, Math.round(v)))} />
        </div>
        <div className="field-row">
          <NumberField label="提前还款罚息" value={inputs.prepayPenaltyPct} suffix="%" step={0.5}
            onChange={(v) => set('prepayPenaltyPct', v)} />
          <MoneyField label="每年提前还款" value={inputs.annualPrepayment} onChange={(v) => set('annualPrepayment', v)} />
        </div>
        <div className="field-row">
          <ToggleField label="Mortgage-Link（上限 50% 贷款额）" value={inputs.mortgageLinkEnabled} onChange={(v) => set('mortgageLinkEnabled', v)} />
        </div>
        <div className="field-row">
          <ToggleField label="居所贷款利息扣税（自住期）" value={inputs.mdiEnabled} onChange={(v) => set('mdiEnabled', v)} />
          <NumberField label="边际税率" value={inputs.mdiMarginalRatePct} suffix="%" step={1}
            onChange={(v) => set('mdiMarginalRatePct', v)} />
        </div>
      </Group>

      <Group title="四、买房 · 持有成本">
        <div className="field-row">
          <MoneyField label="管理费" value={inputs.mgmtFeeMonthly} suffix="/月" step={100} onChange={(v) => set('mgmtFeeMonthly', v)} />
          <NumberField
            label="差饷+地租覆盖（0 = 自动 ≈8%×租金）"
            value={inputs.ratesGovRentOverride ?? 0}
            suffix="/月"
            step={100}
            onChange={(v) => set('ratesGovRentOverride', v === 0 ? null : v)}
          />
        </div>
        <div className="field-row">
          <MoneyField label="火险" value={inputs.fireInsuranceAnnual} suffix="/年" step={100} onChange={(v) => set('fireInsuranceAnnual', v)} />
          <NumberField label="维修保养" value={inputs.maintenancePctOfPrice} suffix="% 楼价/年" step={0.1}
            onChange={(v) => set('maintenancePctOfPrice', v)} />
        </div>
        <div className="field-row">
          <NumberField label="卖楼佣金" value={inputs.sellAgencyFeePct} suffix="%" step={0.25} onChange={(v) => set('sellAgencyFeePct', v)} />
          <MoneyField label="卖楼律师费" value={inputs.legalFeeSell} step={500} onChange={(v) => set('legalFeeSell', v)} />
        </div>
      </Group>

      <Group title="五、出租 + 换大房">
        <div className="field-row">
          <ToggleField label="第 N 年起换大房 + 出租自己单位" value={inputs.rentOutEnabled} onChange={(v) => set('rentOutEnabled', v)} />
        </div>
        <div className="field-row">
          <NumberField label="换大房起始年 N" value={inputs.switchYear} suffix="年（0 = 不换）"
            onChange={(v) => set('switchYear', Math.min(T, Math.max(0, Math.round(v || 0))))} />
          <MoneyField label="出租租金（第 0 年值）" value={inputs.rentalIncomeMonthly0} suffix="/月" step={500}
            onChange={(v) => set('rentalIncomeMonthly0', v)} />
        </div>
        <div className="field-row">
          <MoneyField label="大房租金（第 N 年起首年值）" value={inputs.rent2Monthly} suffix="/月" step={500}
            onChange={(v) => set('rent2Monthly', v)} />
          <NumberField label="空置期" value={inputs.vacancyMonths} suffix="月/年" step={0.5}
            onChange={(v) => set('vacancyMonths', Math.min(12, Math.max(0, v)))} />
        </div>
        <div className="field-row">
          <NumberField label="物业税税率" value={inputs.propertyTaxRatePct} suffix="%" step={1} onChange={(v) => set('propertyTaxRatePct', v)} />
          <NumberField label="物业税修葺扣减" value={inputs.propertyTaxAllowancePct} suffix="%" step={5} onChange={(v) => set('propertyTaxAllowancePct', v)} />
        </div>
        <div className="field-row">
          <NumberField label="出租代理费" value={inputs.letAgentFeeMonths} suffix="月租/次" step={0.5} onChange={(v) => set('letAgentFeeMonths', v)} />
          <NumberField label="换约周期" value={inputs.leaseRenewalCycleYears} suffix="年"
            onChange={(v) => set('leaseRenewalCycleYears', Math.max(1, Math.round(v || 1)))} />
        </div>
        <div className="field-row">
          <MoneyField label="出租维修/家电损耗" value={inputs.rentalMaintenanceAnnual} suffix="/年" step={500} onChange={(v) => set('rentalMaintenanceAnnual', v)} />
          <MoneyField label="出租同意书费" value={inputs.consentToLeaseFee} step={500} onChange={(v) => set('consentToLeaseFee', v)} />
        </div>
      </Group>

      <Group title="六、租房方案">
        <div className="field-block">
          <div className="block-title">租金增长率列表（% / 每年，同时作用于租金支出与出租收入）</div>
          <RateListEditor
            values={inputs.rentGrowthRates}
            count={T}
            onChange={(v) => set('rentGrowthRates', v)}
            kind="growth"
            history={{ label: 'RVD 租金指数', years: HK_HISTORY_RENT_YEARS, yoy: HK_HISTORY.rentYoy }}
          />
        </div>
        <div className="field-row">
          <MoneyField label="小房租金" value={inputs.rent1Monthly} suffix="/月" step={500} onChange={(v) => set('rent1Monthly', v)} />
          <NumberField label="按金" value={inputs.depositMonths} suffix="月" step={1} onChange={(v) => set('depositMonths', v)} />
        </div>
        <div className="field-row">
          <NumberField label="上期" value={inputs.prepaidMonths} suffix="月" step={1} onChange={(v) => set('prepaidMonths', v)} />
          <NumberField label="租客中介费" value={inputs.tenantAgentFeeMonths} suffix="月租/次" step={0.5}
            onChange={(v) => set('tenantAgentFeeMonths', v)} />
        </div>
        <div className="field-row">
          <NumberField label="租客租约印花税" value={inputs.tenantStampDutyPctOfAnnual} suffix="% 年租/次" step={0.05}
            onChange={(v) => set('tenantStampDutyPctOfAnnual', v)} />
          <MoneyField label="搬迁费" value={inputs.movingCostPerMove} suffix="/次" step={500} onChange={(v) => set('movingCostPerMove', v)} />
        </div>
      </Group>

      <Group title="七、共同财务参数">
        <div className="field-row">
          <MoneyField label="月收入" value={inputs.monthlyIncome} step={1000} onChange={(v) => set('monthlyIncome', v)} />
          <NumberField label="收入年增长" value={inputs.incomeGrowthPct} suffix="%" step={0.5} onChange={(v) => set('incomeGrowthPct', v)} />
        </div>
        <div className="field-row">
          <MoneyField label="生活开支" value={inputs.livingExpenseMonthly} suffix="/月" step={500} onChange={(v) => set('livingExpenseMonthly', v)} />
        </div>
        <div className="field-row">
          <NumberField label="定期存款利率" value={inputs.depositRatePct} suffix="%" step={0.25} onChange={(v) => set('depositRatePct', v)} />
          <NumberField label="大额资金投资回报率" value={inputs.investmentReturnPct} suffix="%" step={0.25} onChange={(v) => set('investmentReturnPct', v)} />
        </div>
      </Group>

      <Group title="八、身份">
        <div className="field-row">
          <ToggleField
            label="是否首置"
            value={inputs.isFirstTimeBuyer}
            hint="影响按保资格（>80% 成数仅限首置）；印花税 2024.2 后已无身份差别"
            onChange={(v) => set('isFirstTimeBuyer', v)}
          />
        </div>
        <div className="field-row">
          <button type="button" className="btn" onClick={() => setInputsAll(DEFAULT_INPUTS, set)}>
            恢复默认值
          </button>
        </div>
      </Group>
    </div>
  )
}

function setInputsAll(v: Inputs, set: Setter) {
  for (const k of Object.keys(v) as (keyof Inputs)[]) {
    set(k, v[k])
  }
}
