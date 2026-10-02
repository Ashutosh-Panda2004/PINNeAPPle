import React from 'react'
import clsx from 'clsx'
import type { CheckStatus, SurrogateReport } from '../api'

const VERDICT: Record<string, { label: string; cls: string }> = {
  trustworthy:      { label: 'Trustworthy',      cls: 'bg-green-900/30 border-green-700 text-green-300' },
  use_with_caution: { label: 'Use with caution', cls: 'bg-yellow-900/30 border-yellow-700 text-yellow-300' },
  not_trustworthy:  { label: 'Not trustworthy',  cls: 'bg-red-900/30 border-red-700 text-red-300' },
}

const STATUS_CLS: Record<CheckStatus, string> = {
  pass: 'text-green-400',
  warn: 'text-yellow-400',
  fail: 'text-red-400',
  'n/a': 'text-gray-500',
}

const pct = (v?: number | null, digits = 1) =>
  typeof v === 'number' ? `${v.toFixed(digits)}%` : '—'
const num = (v?: number | null) =>
  typeof v === 'number' ? (Math.abs(v) >= 1e3 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(2) : v.toFixed(3)) : '—'

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-900 rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-100">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

export function SurrogateReportView({ model, report }: { model: string; report: SurrogateReport }) {
  const v = VERDICT[report.verdict.status] ?? VERDICT.use_with_caution
  const err = report.error
  const conformal = report.uncertainty.conformal?.per_field
  const coverage = conformal
    ? Object.values(conformal).map((f) => f.empirical_coverage_pct).filter((x): x is number => typeof x === 'number')
    : []

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-gray-100">{model}</div>
        <span className={clsx('text-xs px-2 py-1 rounded border', v.cls)}>{v.label}</span>
      </div>
      <ul className="text-xs text-gray-400 list-disc pl-5">
        {report.verdict.reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Test error (rel. L2)"
              value={err.available ? pct(err.rel_l2_pct, 2) : 'not measured'}
              sub={err.available ? `${err.n_test_points} held-out points` : 'no reference data'} />
        <Tile label="Convergence" value={report.convergence.status.replace('_', ' ')}
              sub={typeof report.convergence.reduction_factor === 'number'
                ? `loss ↓ ${report.convergence.reduction_factor.toExponential(1)}×` : undefined} />
        <Tile label="Generalization" value={report.generalization.status}
              sub={typeof report.generalization.worst_ratio === 'number'
                ? `unseen / train = ${report.generalization.worst_ratio.toFixed(2)}` : undefined} />
        <Tile label="UQ coverage (target 90%)"
              value={coverage.length ? pct(Math.min(...coverage)) : '—'}
              sub={coverage.length ? 'split conformal, held-out' : 'needs reference data'} />
      </div>

      <div>
        <div className="text-sm font-medium text-gray-300 mb-2">Physics checks</div>
        <table className="w-full text-xs">
          <tbody>
            {report.physics_checks.map((c) => (
              <tr key={c.name} className="border-b border-gray-800/50 align-top">
                <td className={clsx('py-1.5 pr-3 font-semibold uppercase', STATUS_CLS[c.status])}>{c.status}</td>
                <td className="py-1.5 pr-3 text-gray-200 font-mono">{c.name}</td>
                <td className="py-1.5 pr-3 text-gray-400">{c.law ?? ''}</td>
                <td className="py-1.5 pr-3 text-right text-gray-300">{num(c.value)}</td>
                <td className="py-1.5 text-gray-500">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-medium text-gray-300 mb-2">Loss weights & share of final loss</div>
          {(report.weights.loss_terms ?? []).map((t) => (
            <div key={t.term} className="flex items-center gap-2 text-xs mb-1">
              <span className="w-32 font-mono text-gray-300 truncate">{t.term}</span>
              <div className="flex-1 bg-gray-800 rounded h-2">
                <div className="bg-brand-500 h-2 rounded" style={{ width: `${Math.min(100, t.share_pct ?? 0)}%` }} />
              </div>
              <span className="w-12 text-right text-gray-400">{pct(t.share_pct, 0)}</span>
              <span className="w-14 text-right text-gray-500">w={num(t.weight)}</span>
            </div>
          ))}
          {report.weights.imbalanced && <div className="text-xs text-yellow-400 mt-1">{report.weights.message}</div>}
        </div>
        <div>
          <div className="text-sm font-medium text-gray-300 mb-2">Variables</div>
          <table className="w-full text-xs">
            <tbody>
              {(report.variables.inputs ?? []).map((i) => (
                <tr key={`in-${i.name}`} className="text-gray-400">
                  <td className="pr-2">in</td><td className="font-mono text-gray-200 pr-2">{i.name}</td>
                  <td>[{num(i.min)}, {num(i.max)}]</td><td className="text-gray-500">{i.role}</td>
                </tr>
              ))}
              {(report.variables.outputs ?? []).map((o) => (
                <tr key={`out-${o.name}`} className="text-gray-400">
                  <td className="pr-2">out</td><td className="font-mono text-gray-200 pr-2">{o.name}</td>
                  <td>[{num(o.pred_min)}, {num(o.pred_max)}]</td>
                  <td className="text-gray-500">
                    {o.trained_with}
                    {err.per_field?.[o.name] ? ` · err ${pct(err.per_field[o.name].rel_l2_pct, 2)}` : ''}
                    {conformal?.[o.name] ? ` · ±${pct(conformal[o.name].half_width_pct_of_range)} of range` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {report.warnings.length > 0 && (
        <div className="text-xs text-yellow-300 bg-yellow-900/10 border border-yellow-800/50 rounded p-2">
          {report.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
        </div>
      )}
    </div>
  )
}
