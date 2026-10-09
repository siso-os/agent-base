import { useEffect, useRef, useState } from 'react'

export type MotionBankDemoProps = { paused?: boolean; resetKey?: number }

/** Shared visibility policy for the review components; never advances business state. */
export function useMotionGate<T extends HTMLElement = HTMLDivElement>(paused = false) {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const target = ref.current
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncMedia = () => setReducedMotion(media.matches)
    const syncDocument = () => setDocumentVisible(!document.hidden)
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)))
    if (target) observer.observe(target)
    media.addEventListener('change', syncMedia)
    document.addEventListener('visibilitychange', syncDocument)
    syncMedia()
    syncDocument()
    return () => {
      observer.disconnect()
      media.removeEventListener('change', syncMedia)
      document.removeEventListener('visibilitychange', syncDocument)
    }
  }, [])

  return { ref, motion: !paused && visible && documentVisible && !reducedMotion, reducedMotion }
}
