import { useRef, useState } from 'react'
import { DEMO_ZONES } from './constants'
import Toggle from './Toggle'

const LONG_PRESS_MS = 500

function ControlPanel({ demo, onClose }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="mt-16 w-full max-w-sm rounded-lg border border-border bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Demo controls</h2>
          <button onClick={onClose} className="text-text-secondary" aria-label="Close demo controls">
            ✕
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm">Demo mode</div>
            <div className="text-xs text-text-secondary">Mocked AQI, no network requests</div>
          </div>
          <Toggle checked={demo.active} label="Demo mode" onChange={() => demo.toggle()} />
        </div>

        {demo.active && (
          <div className="mt-4">
            <div className="text-xs text-text-secondary">Jump to zone</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {demo.zoneOrder.map((key) => (
                <button
                  key={key}
                  onClick={() => demo.jumpToZone(key)}
                  className={`rounded-full border px-3 py-1.5 text-xs ${
                    demo.zoneKey === key
                      ? 'border-accent bg-accent text-black'
                      : 'border-border bg-bg text-text'
                  }`}
                >
                  {DEMO_ZONES[key].label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => {
            demo.reset()
            onClose()
          }}
          className="mt-5 w-full rounded-lg border border-border py-2.5 text-sm font-medium"
        >
          Reset demo
        </button>
        <p className="mt-2 text-xs text-text-secondary">
          Reset clears the capture flow and any samples taken this run. The seeded log stays.
        </p>
      </div>
    </div>
  )
}

/**
 * The DEMO pill is the on-stage control, not decoration.
 *
 * Tap advances to the next zone; long-press opens the panel. That keeps the
 * stage choreography to one gesture per device — "next" on the clicker, "next"
 * on the phone — with nothing to remember and nothing to mis-select.
 *
 * Sized and contrasted to stay legible composited onto a projector.
 */
export default function DemoPill({ demo }) {
  const [panelOpen, setPanelOpen] = useState(false)
  const timerRef = useRef(null)
  const longPressedRef = useRef(false)

  function startPress() {
    longPressedRef.current = false
    timerRef.current = setTimeout(() => {
      longPressedRef.current = true
      setPanelOpen(true)
    }, LONG_PRESS_MS)
  }

  function endPress() {
    clearTimeout(timerRef.current)
    if (!longPressedRef.current) demo.nextZone()
  }

  function cancelPress() {
    clearTimeout(timerRef.current)
  }

  if (!demo.active) return null

  return (
    <>
      <button
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={`Demo mode, ${demo.zoneLabel}. Tap for next zone, hold for controls.`}
        // Bottom-right rather than top-right: the top corner is the settings
        // gear, and on stage the presenter's thumb is already at the bottom of
        // the phone. Sized for legibility composited onto a projector.
        className="fixed bottom-28 right-3 z-[60] select-none rounded-full border border-accent/60 bg-surface/95 px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-text shadow-lg backdrop-blur"
      >
        <span className="text-accent">DEMO</span>
        <span className="mx-1.5 text-text-secondary">·</span>
        <span>{demo.zoneLabel}</span>
      </button>

      {panelOpen && <ControlPanel demo={demo} onClose={() => setPanelOpen(false)} />}
    </>
  )
}

/** Entry point shown in Settings when demo mode is off. */
export function DemoSettingsRow({ demo }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
      <div>
        <div className="text-sm">Demo mode</div>
        <div className="text-xs text-text-secondary">Mocked AQI for presenting. No network requests.</div>
      </div>
      <Toggle checked={demo.active} label="Demo mode" onChange={() => demo.toggle()} />
    </div>
  )
}
