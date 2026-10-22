/** A single swish on arrival; the hoop stays still afterward. */
export default function CastHoop() {
  return <svg className="cast-hoop" viewBox="0 0 56 40" width="38" height="28" fill="none" aria-hidden="true">
    <path d="M43 8v17M35 8h8" stroke="#a6a6b5" strokeWidth="2" strokeLinecap="round" />
    <path className="cast-hoop-net" d="m24 24 4 10h10l4-10m-16 2 13 6m-10 0 11-6m-7-2v10" stroke="#d9d9e3" strokeWidth="1.2" strokeLinejoin="round" />
    <g className="cast-hoop-ball"><circle cx="33" cy="20" r="5" fill="#f6a044" stroke="#ac591e" /><path d="M28 20h10m-5-5v10m-4-8c4 1 5 4 6 7" stroke="#8d491e" strokeWidth=".7" /></g>
    <ellipse cx="33" cy="24" rx="10" ry="2" stroke="#ff8552" strokeWidth="2" />
  </svg>;
}
