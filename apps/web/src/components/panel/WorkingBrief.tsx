import { useEffect, useState } from 'react';
import './WorkingBrief.css';

interface Brief {
  found: boolean;
  title?: string;
  writtenAt?: string | null;
  done?: string[];
  next?: string[];
  threads?: string[];
  keyPaths?: string[];
  words?: string;
}

interface BriefCard {
  doing?: string;
  next?: string;
  summary?: string;
  updated?: string;
}

interface BriefResponse {
  source: 'handoff' | 'card' | 'none';
  file?: string;
  mtime?: number;
  brief?: Brief;
  card?: BriefCard | null;
}

interface WorkingBriefProps {
  agentName: string;
}

export function WorkingBrief({ agentName }: WorkingBriefProps) {
  const [data, setData] = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    fetch(`/api/agents/${encodeURIComponent(agentName)}/brief`)
      .then(res => res.json())
      .then((briefData: BriefResponse) => {
        setData(briefData);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [agentName]);

  if (loading) {
    return <div className="working-brief-loading">Loading…</div>;
  }

  if (!data) {
    return null;
  }

  const brief = data.brief;
  const card = data.card;

  // Determine what to display
  const goal = brief?.words || brief?.title;
  const doing = card?.doing;
  const nextSteps = brief?.next || (card?.next ? [card.next] : []);
  const threads = brief?.threads || [];
  const mtime = data.mtime ? new Date(data.mtime) : null;
  const cardUpdated = card?.updated ? new Date(card.updated) : null;

  // Determine footer text
  let footerText = '';
  if (data.source === 'handoff') {
    if (mtime) {
      const time = mtime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      footerText = `from HANDOFF.md · written ${time}`;
    }
  } else if (data.source === 'card') {
    if (cardUpdated) {
      const time = cardUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      footerText = `from its card · updated ${time}`;
    }
  } else {
    footerText = 'no handoff found';
  }

  // Max 3 threads + "+N more"
  const displayThreads = threads.slice(0, 3);
  const moreThreads = threads.length > 3 ? threads.length - 3 : 0;

  return (
    <div className="working-brief">
      <h3 className="working-brief-title">Working brief</h3>

      {goal && (
        <div className="working-brief-row">
          <div className="working-brief-label">Goal</div>
          <div className="working-brief-value">{goal}</div>
        </div>
      )}

      {doing && (
        <div className="working-brief-row">
          <div className="working-brief-label">Doing</div>
          <div className="working-brief-value">{doing}</div>
        </div>
      )}

      {nextSteps.length > 0 && (
        <div className="working-brief-row">
          <div className="working-brief-label">Next</div>
          <div className="working-brief-value">
            {nextSteps.map((step: string, i: number) => (
              <div key={i}>{step}</div>
            ))}
          </div>
        </div>
      )}

      {threads.length > 0 && (
        <div className="working-brief-row">
          <div className="working-brief-label">Open</div>
          <div className="working-brief-value">
            {displayThreads.map((thread: string, i: number) => (
              <div key={i} className="working-brief-thread">
                · {thread}
              </div>
            ))}
            {moreThreads > 0 && (
              <div className="working-brief-more">+{moreThreads} more</div>
            )}
          </div>
        </div>
      )}

      <div className="working-brief-footer">
        {footerText}
        {data.file && (
          <a href="#" className="working-brief-link">
            open file ↗
          </a>
        )}
      </div>
    </div>
  );
}
