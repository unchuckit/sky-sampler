/**
 * Switch control.
 *
 * The knob is centred by flexbox rather than by a vertical translate. The
 * earlier version stacked `translate-y-0.5` with `translate-x-*` on the same
 * element, and the horizontal utility overwrote the vertical one, so the knob
 * sat hard against the top edge of the track. Padding plus `items-center`
 * cannot drift: track 24px − 2×2px padding = 20px knob, and the travel is
 * exactly the leftover 20px.
 */
export default function Toggle({ checked, onChange, label }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${
        checked ? 'bg-accent' : 'bg-border'
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-text shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
