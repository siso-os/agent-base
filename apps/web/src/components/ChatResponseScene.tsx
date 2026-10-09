import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AgentFace } from '../../../../packages/halo-face/living-assets'
import { ChatActivityRail, type ChatActivityIdentity, type ChatActivityRailProps } from './ChatActivityRail'
import { useMotionGate } from './motion-bank-shared'
import './ChatResponseScene.css'

export type ChatResponseSceneProps = {
  prompt: string; owner: ChatActivityIdentity
  activity?: Omit<ChatActivityRailProps, 'paused' | 'replay' | 'owner'>
  answer: string; status: 'working' | 'streaming' | 'complete' | 'failed' | 'unconfirmed'
  /** Existing chat owns prompt/Markdown/checkpoint rendering when embedded in its transcript. */
  hidePrompt?: boolean; answerContent?: ReactNode; showActions?: boolean
  variant?: 'compact' | 'expressive'; paused?: boolean; revision?: string | number
  /** Optional caller-owned result description; no artifact count is inferred. */
  outputSummary?: string
  failure?: string; onLink?: (href: string) => void; onInspectOutputs?: () => void; className?: string
}
/** Shared answer/output action: feedback follows the actual clipboard promise. */
export function ConfirmedCopy({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const mounted = useRef(false), request = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++ } }, [])
  useEffect(() => { request.current++; setState('idle') }, [text])
  const copy = async () => {
    const token = ++request.current
    setState('copying')
    try {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      if (mounted.current && token === request.current) setState('copied')
    } catch { if (mounted.current && token === request.current) setState('failed') }
  }
  return <span className={`cr-copy ${className}`}><button type="button" onClick={() => void copy()} disabled={state === 'copying'}>{state === 'copying' ? 'Copying…' : state === 'copied' ? 'Copied' : label}</button><span role="status" className="cr-copy-message">{state === 'failed' ? 'Copy failed. Select the text to copy manually.' : state === 'copied' ? 'Clipboard confirmed.' : ''}</span></span>
}
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return ''
}
function MarkdownPre({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children)[0]
  if (isValidElement<{ children?: ReactNode; className?: string }>(child)) return <MarkdownCode className={child.props.className}>{child.props.children}</MarkdownCode>
  return <MarkdownCode>{children}</MarkdownCode>
}
function MarkdownCode({ children, className }: { children?: ReactNode; className?: string }) {
  const text = textOf(children)
  return <div className="cr-code"><div className="cr-code-head"><span>{className?.replace('language-', '') || 'Code'}</span><ConfirmedCopy text={text} label="Copy code" /></div><pre><code className={className}>{children}</code></pre></div>
}
/** Supplied text remains rendered, selectable and accessible in every motion state. */
export function ChatResponseScene({ prompt, owner, activity, answer, status, hidePrompt = false, answerContent, showActions = true, variant = 'expressive', paused = false, revision = 0, failure = 'The response failed. No completion receipt was supplied.', onLink, onInspectOutputs, outputSummary, className = '' }: ChatResponseSceneProps) {
  const { ref, motion } = useMotionGate(paused || status === 'failed')
  return <div ref={ref} className={`cr-scene cr-${variant} ${className}`} data-motion={motion ? 'on' : 'off'} data-status={status}>
    {!hidePrompt && <div className="cr-prompt"><span className="cr-prompt-label">YOU</span><p>{prompt}</p></div>}
    <div className="cr-response">
      <header className="cr-owner"><AgentFace {...owner} size={variant === 'expressive' ? 40 : 28} status={status === 'complete' ? 'done' : status === 'failed' ? 'blocked' : status === 'unconfirmed' ? 'waiting' : 'working'} paused={!motion || status === 'unconfirmed'} /><span className="cr-owner-copy"><strong>{owner.name || 'Owner'}</strong><small>{owner.project || 'Workspace'} · <span>{status === 'streaming' ? 'Responding' : status === 'working' ? 'Working' : status === 'failed' ? 'Failed' : status === 'unconfirmed' ? 'Completion unconfirmed' : 'Complete'}</span></small></span><span className="cr-status-dot" aria-hidden="true"/></header>
      {activity && <ChatActivityRail {...activity} owner={owner} paused={!motion} replay={typeof revision === 'number' ? revision : 0} />}
      {status === 'failed' && <div className="cr-failure" role="status"><strong>Response interrupted</strong><p>{failure}</p></div>}
      {answer ? <article key={revision} className="cr-answer" aria-label="Supplied answer">
        <div className="cr-answer-rule"><span>{status === 'complete' ? 'REVIEW DOCUMENT' : status === 'failed' ? 'PARTIAL DOCUMENT' : 'RESPONSE DOCUMENT'}</span><span>{status === 'complete' ? 'Supplied completion' : status === 'streaming' ? 'Text supplied so far' : 'Supplied text'}</span></div>
        <div className={answerContent ? "cr-native" : "cr-markdown"}>{answerContent ?? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href) onLink?.(href) }}>{children}</a>,
          pre: ({ children }) => <MarkdownPre>{children}</MarkdownPre>,
          code: ({ children, className }) => <code className={className}>{children}</code>,
        }}>{answer}</ReactMarkdown>}</div>
        {status === 'streaming' && <span className="cr-caret" aria-label="Response still in progress"/>}
        {showActions && <footer className="cr-answer-actions"><ConfirmedCopy text={answer} label="Copy answer" />{onInspectOutputs && <button type="button" className="cr-output-action" aria-label="Inspect outputs" onClick={onInspectOutputs}><span className="cr-output-copy"><strong>Inspect outputs</strong>{outputSummary && <small>{outputSummary}</small>}</span><span aria-hidden="true">↗</span></button>}</footer>}
      </article> : <p className="cr-wait">{status === 'failed' ? 'No answer was supplied.' : 'The answer appears here when text is supplied.'}</p>}
    </div>
  </div>
}
