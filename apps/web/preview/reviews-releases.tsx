import {createRoot} from 'react-dom/client';
import {ReviewsHistory,useReviewsHistory} from '../src/components/panel/ReviewsHistory';
import {WhatsNewPage} from '../src/components/WhatsNew';
import '../src/index.css';
function Fixture(){const history=useReviewsHistory();return <main data-testid="reviews-releases-fixture" style={{maxWidth:1440,margin:'auto',padding:16,color:'var(--crm-color-text)'}}><h1 style={{fontSize:20,marginBottom:12}}>Review history and release evidence · synthetic fixture</h1><section style={{maxWidth:800,margin:'0 auto 24px',padding:20,background:'var(--crm-color-panel)',borderRadius:12}}><h2>Reviews</h2><ReviewsHistory {...history} onOpened={history.opened} onOpen={()=>{}} /></section><WhatsNewPage/></main>};createRoot(document.getElementById('root')!).render(<Fixture/>);
