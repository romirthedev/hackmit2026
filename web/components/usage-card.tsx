'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';

type UsageTotals = {
  calls: number;
  model_calls: number;
  avoided_calls: number;
  total_tokens: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  unmetered_calls: number;
  inference_seconds: number | null;
  estimated_tokens_avoided: number | null;
  estimated_naive_tokens: number | null;
  unestimated_avoided_calls?: number;
};
type UsageSummary = {
  enabled: boolean;
  since: number | null;
  totals: UsageTotals;
  by_stage: (UsageTotals & { stage: string })[];
  pricing: {
    input_per_million_usd: number;
    output_per_million_usd: number;
    cached_input_per_million_usd: number;
    basis: string;
  };
  cloud_equivalent: {
    actual_usd: number | null;
    estimated_avoided_usd: number | null;
    estimated_naive_usd: number | null;
    incomplete?: boolean;
  };
  recent_frames: {
    media_id: string;
    label_mode: string;
    inherited_from: string | null;
    block_delta: number | null;
  }[];
};

function count(value: number | null | undefined) {
  return value == null ? 'Not measured' : value.toLocaleString();
}

function dollars(value: number | null | undefined) {
  return value == null ? 'Not measured' : `$${value.toFixed(4)}`;
}

export function UsageCard() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const result = await api<UsageSummary>('/usage/summary?since=0');
        if (active) {
          setUsage(result);
          setError('');
        }
      } catch {
        if (active) setError('Usage measurements are currently unavailable.');
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <Card className="card" aria-label="Measured model usage">
      <div className="row">
        <h2>Model usage</h2>
        <span className="meta">This workspace · recorded ledger history</span>
      </div>
      {error && <output className="error-text">{error}</output>}
      {!usage ? (
        <p className="muted">Loading measurements…</p>
      ) : !usage.enabled ? (
        <p className="muted">
          The token ledger is disabled. No savings are inferred from earlier
          recordings.
        </p>
      ) : (
        <>
          <dl>
            <dt>Measured model tokens</dt>
            <dd>{count(usage.totals.total_tokens)}</dd>
            <dt>Estimated tokens without gates</dt>
            <dd>{count(usage.totals.estimated_naive_tokens)}</dd>
            <dt>Estimated tokens avoided</dt>
            <dd>{count(usage.totals.estimated_tokens_avoided)}</dd>
            <dt>Model calls / calls avoided</dt>
            <dd>
              {count(usage.totals.model_calls)} /{' '}
              {count(usage.totals.avoided_calls)}
            </dd>
            <dt>Calls missing token measurements</dt>
            <dd>{count(usage.totals.unmetered_calls)}</dd>
            <dt>Measured cloud-equivalent cost</dt>
            <dd>{dollars(usage.cloud_equivalent.actual_usd)}</dd>
            <dt>Estimated cloud-equivalent avoided</dt>
            <dd>{dollars(usage.cloud_equivalent.estimated_avoided_usd)}</dd>
          </dl>
          <p className="meta">
            Estimates for avoided calls are separate from runtime-reported
            tokens. Unmetered calls make totals incomplete.
          </p>
          {usage.cloud_equivalent.incomplete && (
            <output className="meta">
              Partial measurements: the displayed costs do not cover every call.
            </output>
          )}
          <p className="meta">
            Illustrative cloud equivalent, not your bill: $
            {usage.pricing.input_per_million_usd}/M input, $
            {usage.pricing.output_per_million_usd}/M output, $
            {usage.pricing.cached_input_per_million_usd}/M cached input when
            reported.
          </p>
          {usage.by_stage.length > 0 && (
            <dl>
              {usage.by_stage.map((stage) => (
                <div key={stage.stage} style={{ display: 'contents' }}>
                  <dt>{stage.stage}</dt>
                  <dd>
                    {count(stage.total_tokens)} tokens · {stage.calls} calls
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {usage.recent_frames.length > 0 && (
            <div>
              <h3>Recent frames</h3>
              <ul className="flex flex-wrap gap-2 mt-3 list-none p-0">
                {usage.recent_frames.slice(0, 10).map((frame) => (
                  <li key={frame.media_id}>
                    <a
                      className="status"
                      href={`/api/media/${encodeURIComponent(frame.media_id)}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Open retained original frame"
                    >
                      {frame.label_mode === 'inherited'
                        ? 'Inherited'
                        : frame.label_mode === 'described'
                          ? 'Described'
                          : 'Unclassified'}
                      {frame.block_delta == null
                        ? ''
                        : ` · Δ ${frame.block_delta.toFixed(3)}`}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="meta">
                Inherited captions are reused observations; each original frame
                remains available.
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
