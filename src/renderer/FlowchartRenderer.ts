import type { ParsedLog } from '../parser/types';
import type { Transaction, ExecutionPhase } from '../parser/transaction-types';
import { formatDuration } from '../utils/TimeUtils';

// ─── Color & icon maps ────────────────────────────────────────────────────────

function nodeColor(type: string): string {
  switch (type) {
    case 'BEFORE_TRIGGER':
    case 'AFTER_TRIGGER':   return '#f97316';
    case 'FLOW':
    case 'PROCESS_BUILDER': return '#a78bfa';
    case 'VALIDATION_RULE':
    case 'WORKFLOW_RULE':   return '#fbbf24';
    case 'SOQL':
    case 'DML':             return '#34d399';
    case 'CALLOUT':         return '#fbbf24';
    case 'APEX_CLASS':
    case 'ANONYMOUS_APEX':  return '#60a5fa';
    default:                return '#6b737f';
  }
}

function nodeIcon(type: string): string {
  switch (type) {
    case 'BEFORE_TRIGGER':
    case 'AFTER_TRIGGER':   return '🔔';
    case 'FLOW':            return '🔀';
    case 'PROCESS_BUILDER': return '⚙';
    case 'VALIDATION_RULE': return '✅';
    case 'WORKFLOW_RULE':   return '📋';
    case 'SOQL':            return '🔍';
    case 'DML':             return '💾';
    case 'CALLOUT':         return '🌐';
    case 'APEX_CLASS':
    case 'ANONYMOUS_APEX':  return '⚡';
    default:                return '•';
  }
}

// ─── Phase node renderer ──────────────────────────────────────────────────────

function renderFlowNode(phase: ExecutionPhase): string {
  const color  = nodeColor(phase.type);
  const icon   = nodeIcon(phase.type);
  const dur    = formatDuration(phase.durationMs);
  const meta   = [phase.objectName, phase.operation].filter(Boolean).join(' · ');

  return /* html */`
    <div class="fc-node" style="--node-color:${color}">
      <span class="fc-node-icon">${icon}</span>
      <div class="fc-node-body">
        <div class="fc-node-name">${escHtml(phase.name)}</div>
        ${meta ? `<div class="fc-node-meta">${escHtml(meta)}</div>` : ''}
      </div>
      <span class="fc-node-dur">${dur}</span>
    </div>
  `;
}

// ─── Transaction chain renderer ───────────────────────────────────────────────

function renderTransactionChain(tx: Transaction, index: number): string {
  if (tx.phases.length === 0) {
    // No phases — render a single placeholder node
    return /* html */`
      <div class="fc-tx-label">Run #${index} · ${escHtml(tx.entryPoint)}</div>
      <div class="fc-node" style="--node-color:#6b737f">
        <span class="fc-node-icon">▶</span>
        <div class="fc-node-body">
          <div class="fc-node-name">${escHtml(tx.entryPoint)}</div>
          <div class="fc-node-meta">No phases detected</div>
        </div>
        <span class="fc-node-dur">${formatDuration(tx.durationMs)}</span>
      </div>
    `;
  }

  // Only render depth-0 phases in the flat flow view to keep it readable
  const topPhases = tx.phases.filter(p => p.depth === 0);
  const phasesToRender = topPhases.length > 0 ? topPhases : tx.phases;

  const nodes = phasesToRender.map((phase, i) => /* html */`
    ${i > 0 ? '<div class="fc-arrow"></div>' : ''}
    ${renderFlowNode(phase)}
  `).join('');

  return /* html */`
    <div class="fc-tx-label">Run #${index} · ${escHtml(tx.entryPoint)}</div>
    ${nodes}
  `;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Renders a CSS-based flowchart for all transactions in the log.
 * Returns a self-contained HTML string (no external dependencies).
 */
export function renderFlowchart(log: ParsedLog): string {
  if (log.transactions.length === 0) {
    return `<div class="fc-empty">No transactions to display.</div>`;
  }

  const chains = log.transactions
    .map((tx, i) => renderTransactionChain(tx, i + 1))
    .join('');

  return /* html */`<div class="fc-container">${chains}</div>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
