import type { PromotionHandoff } from './schemas/handoff';
import type { PromotionChecklist } from './schemas/checklist';

export interface PackageResult {
  handoff: PromotionHandoff;
  checklist: PromotionChecklist | null;
  linksMarkdown: string;
}

export function generateLinksMarkdown(handoff: PromotionHandoff): string {
  const lines: string[] = [];

  lines.push(`# ${handoff.title}`);
  lines.push('');
  lines.push(`**Summary:** ${handoff.summary}`);
  lines.push(`**Verdict:** ${handoff.promotionVerdict}`);
  lines.push(`**From:** ${handoff.fromLayer} → ${handoff.toLayer}`);
  lines.push(`**Target:** ${handoff.targetId}`);
  lines.push('');

  if (handoff.whyNow.length > 0) {
    lines.push('## Why Now');
    for (const reason of handoff.whyNow) {
      lines.push(`- ${reason}`);
    }
    lines.push('');
  }

  if (handoff.stableObjects.length > 0) {
    lines.push('## Stable Objects');
    for (const obj of handoff.stableObjects) {
      const parts = [`\`${obj.kind}\`: ${obj.id}`];
      if (obj.path) parts.push(`(${obj.path})`);
      if (obj.note) parts.push(`— ${obj.note}`);
      lines.push(`- ${parts.join(' ')}`);
    }
    lines.push('');
  }

  if (handoff.sourceLinks.length > 0) {
    lines.push('## Source Links');
    for (const link of handoff.sourceLinks) {
      const parts = [`\`${link.kind}\`: ${link.ref}`];
      if (link.whyRelevant) parts.push(`— ${link.whyRelevant}`);
      lines.push(`- ${parts.join(' ')}`);
    }
    lines.push('');
  }

  if (handoff.knownGaps.length > 0) {
    lines.push('## Known Gaps');
    for (const gap of handoff.knownGaps) {
      lines.push(`- ${gap}`);
    }
    lines.push('');
  }

  if (handoff.constraints.length > 0) {
    lines.push('## Constraints');
    for (const constraint of handoff.constraints) {
      lines.push(`- ${constraint}`);
    }
    lines.push('');
  }

  if (handoff.blockersResolved.length > 0) {
    lines.push('## Blockers Resolved');
    for (const blocker of handoff.blockersResolved) {
      lines.push(`- ${blocker}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function packageHandoff(
  handoff: PromotionHandoff,
  checklist?: PromotionChecklist,
): PackageResult {
  return {
    handoff,
    checklist: checklist ?? null,
    linksMarkdown: generateLinksMarkdown(handoff),
  };
}
