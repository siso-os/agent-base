import { WorkingBrief } from '../src/components/panel/WorkingBrief';

// Mock fetch for preview
declare global {
  var mockBriefs: Record<string, any>;
}

globalThis.mockBriefs = {
  'AGENT-WITH-HANDOFF': {
    source: 'handoff',
    file: '~/SISO_Workspace/SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agent-base/.agents/HANDOFF.md',
    mtime: Date.now() - 300000, // 5 minutes ago
    brief: {
      found: true,
      title: 'AB-ZERO — 8 Oct 2026 · the one Agent Base agent',
      writtenAt: new Date(Date.now() - 300000).toISOString(),
      done: ['Rolodex v3 + Life live', 'The 36 designs rated'],
      next: ['His queue, t-0508'],
      threads: ['AB-ASTRA on t-0519', 'Ship queue down', 'Rolodex chat key→jid'],
      keyPaths: ['~/SISO_Workspace/_data/project-zeros/AB-ZERO.md', 'ui-hub/_astra/runs/2026-10-08/'],
      words: '"Overview copy and the owner one-pager next"',
    },
  },
  'AGENT-CARD-ONLY': {
    source: 'card',
    card: {
      doing: 'Building new feature',
      next: 'Deploy to staging',
      summary: 'Feature implementation in progress',
      updated: new Date(Date.now() - 600000).toISOString(), // 10 minutes ago
    },
  },
  'AGENT-NO-HANDOFF': {
    source: 'none',
    card: null,
  },
};

// Override fetch for preview
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url: string | Request) => {
  const urlStr = typeof url === 'string' ? url : url.url;
  const match = urlStr.match(/\/api\/agents\/([^/]+)\/brief/);
  if (match) {
    const agentName = decodeURIComponent(match[1]);
    const data = globalThis.mockBriefs[agentName];
    if (data) {
      return {
        json: async () => data,
        ok: true,
        status: 200,
      } as any;
    }
  }
  return originalFetch.call(this, url);
} as any;

export function Preview() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '40px', padding: '20px', background: '#1a1a1a', color: '#fff' }}>
      <div>
        <h2>HANDOFF brief (full data)</h2>
        <div style={{ border: '1px solid #333', borderRadius: '8px', overflow: 'hidden', maxWidth: '360px' }}>
          <WorkingBrief agentName="AGENT-WITH-HANDOFF" />
        </div>
      </div>

      <div>
        <h2>Card-only brief (no HANDOFF)</h2>
        <div style={{ border: '1px solid #333', borderRadius: '8px', overflow: 'hidden', maxWidth: '360px' }}>
          <WorkingBrief agentName="AGENT-CARD-ONLY" />
        </div>
      </div>

      <div>
        <h2>No brief found</h2>
        <div style={{ border: '1px solid #333', borderRadius: '8px', overflow: 'hidden', maxWidth: '360px' }}>
          <WorkingBrief agentName="AGENT-NO-HANDOFF" />
        </div>
      </div>

      <div>
        <h2>On phone (390px)</h2>
        <div style={{ border: '1px solid #333', borderRadius: '8px', overflow: 'hidden', width: '390px' }}>
          <WorkingBrief agentName="AGENT-WITH-HANDOFF" />
        </div>
      </div>
    </div>
  );
}
