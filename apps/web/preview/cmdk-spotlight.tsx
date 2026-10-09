// uihub: arc:command-palette
import { BankWorkspacePalette } from "../src/components/BankNavigationAdapters";
import { publishLive } from "../src/lib/chatLive";
import type { Agent } from "../src/lib/agents";
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@siso/tokens/siso.css'
import {
  WorkspaceCommandPalette,
  type WorkspaceCommandAction,
  type WorkspaceCommandPaletteProps,
} from '../src/components/WorkspaceCommandPalette'

// Synthetic data only; component, icons and tokens are actual app imports.
type FixtureAction = WorkspaceCommandAction & {
  kind: 'chats' | 'projects' | 'pages' | 'commands'
  scope: string
  shortcut: string[]
  preview: string
  available: boolean
  sourceLabel: string
}

const actions: FixtureAction[] = [
  {
    id: 'chat-design', label: 'Design review',
    description: 'Review the navigation draft', icon: 'agent-base',
    kind: 'chats', scope: 'Agent Base', shortcut: ['Enter'],
    preview: 'Synthetic chat: navigation sketches and review notes.',
    available: true, sourceLabel: 'Fixture chats',
  },
  {
    id: 'atlas-agency', label: 'Project Atlas',
    description: 'Agency project overview', icon: 'web',
    kind: 'projects', scope: 'Agency', shortcut: ['Enter'],
    preview: 'Agency Atlas: client work and the next milestone.',
    available: true, sourceLabel: 'Fixture projects',
  },
  {
    id: 'atlas-labs', label: 'Project Atlas',
    description: 'Labs project overview', icon: 'web',
    kind: 'projects', scope: 'Labs', shortcut: ['Enter'],
    preview: 'Labs Atlas: experiments and the next review.',
    available: true, sourceLabel: 'Fixture projects',
  },
  {
    id: 'page-library', label: 'Great Library',
    description: 'References and saved pages', icon: 'library',
    kind: 'pages', scope: 'SISO', shortcut: ['Enter'],
    preview: 'Synthetic page: the shared reference collection.',
    available: true, sourceLabel: 'Fixture pages',
  },
  {
    id: 'page-long',
    label: 'A very long research title about workspace navigation, keyboard attention, and keeping every destination readable on a narrow screen',
    description: 'A deliberately long synthetic page description for responsive layout inspection',
    icon: 'library', kind: 'pages', scope: 'Research / navigation',
    shortcut: ['Enter'],
    preview: 'Long title preview with an uninterrupted identifier: workspace_navigation_research_abcdefghijklmnopqrstuvwxyz_0123456789.',
    available: true, sourceLabel: 'Fixture pages',
  },
  {
    id: 'chat-offline', label: 'Unavailable chat',
    description: 'Synthetic source is unavailable', icon: 'agent-base',
    kind: 'chats', scope: 'Offline fixture', shortcut: ['Enter'],
    preview: 'This chat cannot be opened while its source is unavailable.',
    available: false, sourceLabel: 'Fixture chats',
  },
  {
    id: 'command-theme', label: 'Toggle theme',
    description: 'Change appearance in this fixture', icon: 'web',
    kind: 'commands', scope: 'Workspace', shortcut: ['Enter'],
    preview: 'Synthetic command: records a selection only.',
    available: true, sourceLabel: 'Fixture commands',
  },
  {
    id: 'command-settings', label: 'Open settings',
    description: 'Workspace preferences', icon: 'estate',
    kind: 'commands', scope: 'Workspace', shortcut: ['Enter'],
    preview: 'Synthetic settings command: no live destination.',
    available: true, sourceLabel: 'Fixture commands',
  },
]

function AdapterFixture() {
  const [open, setOpen] = useState(false), [receipt, setReceipt] = useState('none');
  const offline = new URLSearchParams(location.search).get('state') === 'offline';
  const mismatchedSession = new URLSearchParams(location.search).get('state') === 'mismatch';
  const agent = {id:'fixture-agent',name:'Fixture chat',title:'Read-only fixture',row:'live',session:mismatchedSession ? 'new-fixture-session' : 'fixture-session',machine:'Fixture machine',tool:'fixture',cwd:'/synthetic',status:'idle',pages:[]} as unknown as Agent;
  useEffect(() => { publishLive(agent.id, {state:'idle',step:'',turnAt:null,preview:{text:'An already-read synthetic reply.',at:1,session:'fixture-session'}}); return () => publishLive(agent.id,null); }, []);
  return <main className="fixture-shell"><h1>Connected action adapter · synthetic</h1><button data-testid="launch" onClick={event=>{ event.currentTarget.focus(); setOpen(true); }}>Open workspace search</button>
    <BankWorkspacePalette agents={[agent]} workspaces={[{id:'one',name:'Atlas',color:'#aaa',order:0},{id:'two',name:'Atlas',color:'#aaa',order:1}]} connected={!offline} open={open} onOpenChange={setOpen}
      onOpenAgent={a=>setReceipt(`agent:${a.id}`)} onOpenWorkspace={id=>setReceipt(`workspace:${id}`)}
      pages={['agents','tasks','library','estate','voice'].map(id=>({id,label:id,description:`Open ${id}`,icon:'agent-base',onSelect:()=>setReceipt(`page:${id}`)}))}
      browserTabs={[{id:'old',title:'Older duplicate',url:'https://example.test/a'},{id:'new',title:'Existing tab',url:'https://example.test/a'}]}
      browserPages={[{title:'Duplicate saved page',url:'https://example.test/a'},{title:'Saved reference',url:'https://example.test/b'}]}
      onBrowserTab={id=>setReceipt(`tab:${id}`)} onGo={url=>setReceipt(`go:${url}`)} onTerminal={()=>setReceipt('terminal')} />
    <output data-testid="selection">{receipt}</output></main>
}
function Fixture() {
  const state = new URLSearchParams(location.search).get('state') ?? 'blank'
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(
    state === 'typing' ? 'Atlas'
      : state === 'empty' ? 'zz-no-match-zz'
        : state === 'commands' ? '>' : '',
  )
  const [activeActionId, setActiveActionId] = useState<string | null>(null)
  const [recentIds, setRecentIds] = useState(['page-library', 'chat-design'])
  const [selected, setSelected] = useState('none')
  const [remembered, setRemembered] = useState('none')

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.metaKey && event.shiftKey && event.code === 'KeyS') document.body.dataset.escapedShortcut = 'true';
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(value => !value)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  // The intersection also permits the historical component in --before mode.
  const props: WorkspaceCommandPaletteProps & {
    recentIds: string[]
    sourceUnavailable?: string
    onRemember: (id: string) => void
  } = {
    open, query, actions, activeActionId,
    onOpenChange: setOpen,
    onQueryChange: value => { setQuery(value); setActiveActionId(null) },
    onActiveActionChange: setActiveActionId,
    onSelect: action => setSelected(action.id),
    paused: true,
    triggerLabel: 'Search workspace',
    recentIds,
    sourceUnavailable: state === 'unavailable'
      ? 'Fixture projects source unavailable. Last known destinations are shown.'
      : undefined,
    onRemember: id => {
      setRemembered(id)
      setRecentIds(previous => [id, ...previous.filter(value => value !== id)].slice(0, 6))
    },
  }

  return <main className="fixture-shell">
    <p>AGENT BASE · SYNTHETIC PREVIEW</p>
    <h1>Find your next destination</h1>
    <p>Projects, chats, pages and commands. Local fixture state: {state}.</p>
    <div className="fixture-controls">
      <button type="button" data-testid="launch" onClick={event => { event.currentTarget.focus(); setOpen(true); }}>
        Open workspace search
      </button>
      <textarea aria-label="Draft" defaultValue="Draft message with a saved caret" />
    </div>
    <WorkspaceCommandPalette {...props} />
    <output className="fixture-receipt" data-testid="selection">{selected}</output>
    <output className="fixture-receipt" data-testid="remembered">{remembered}</output>
    <output className="fixture-receipt" data-testid="recents">{recentIds.join(',')}</output>
  </main>
}

createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('adapter') ? <AdapterFixture /> : <Fixture />)
