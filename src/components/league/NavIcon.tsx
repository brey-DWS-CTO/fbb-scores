// Every icon in the app is drawn here. No emoji in the UI: they render as a
// different picture on every phone, and some of them are colour. These are
// stroke-only paths on a 24x24 grid that take their colour from the text
// around them.
const paths = {
  lock: 'M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  unlocked: 'M6 10h12v11H6z M8 10V6a4 4 0 0 1 7.7-1.4 M12 14v3',
  target: 'M22 12a10 10 0 1 1-10-10 10 10 0 0 1 10 10 M18 12a6 6 0 1 1-6-6 6 6 0 0 1 6 6 M14 12a2 2 0 1 1-2-2 2 2 0 0 1 2 2',
  people: 'M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M2 21v-3a6 6 0 0 1 12 0v3 M18 3a4 4 0 0 1 0 8 M18 15a4 4 0 0 1 4 4v2',
  arrows: 'M3 7h18 M17 3l4 4-4 4 M21 17H3 M7 13l-4 4 4 4',
  swap: 'M17 2l4 4-4 4 M3 12v-2a4 4 0 0 1 4-4h14 M7 22l-4-4 4-4 M21 12v2a4 4 0 0 1-4 4H3',
  book: 'M12 5v16 M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1',
  ballot: 'M8 3h8v9H8z M10 7l2 2 3-4 M5 10l-3 5v6h20v-6l-3-5 M2 15h20',
  home: 'M3 10l9-8 9 8 M5 9v12h5v-7h4v7h5V9',
  trophy: 'M7 3h10v6a5 5 0 0 1-10 0z M7 5H3v3a4 4 0 0 0 4 4 M17 5h4v3a4 4 0 0 1-4 4 M12 14v7 M7 21h10',
  calendar: 'M3 5h18v16H3z M7 2v6 M17 2v6 M3 10h18 M7 14h2 M13 14h2 M7 18h2',
  shield: 'M12 2l9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6z M8 12l3 3 5-6',
  crown: 'M3 7l3.5 3.5L12 4l5.5 6.5L21 7l-2 12H5z M5 15h14',
  tv: 'M3 8h18v12H3z M8 2l4 5 4-5',
  flask: 'M9 2h6 M10 2v7l-5.6 9.4A2 2 0 0 0 6.1 22h11.8a2 2 0 0 0 1.7-3.6L14 9V2 M7.6 15h8.8',
  warning: 'M12 3.5 21.5 20H2.5z M12 10v4 M12 17.2v.1',
  star: 'M12 3.2l2.7 6 6.5.7-4.9 4.4 1.4 6.5-5.7-3.4-5.7 3.4 1.4-6.5L2.8 9.9l6.5-.7z',
  pencil: 'M4 20h4L19.5 8.5a2.5 2.5 0 0 0-3.5-3.5L4 16.5z M14.5 6.5l3.5 3.5',
  sun: 'M17 12a5 5 0 1 1-5-5 5 5 0 0 1 5 5 M12 1.5v2 M12 20.5v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1.5 12h2 M20.5 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  moon: 'M20.5 14.8A8.6 8.6 0 0 1 9.2 3.5a8.6 8.6 0 1 0 11.3 11.3z',
  hidden: 'M3 4l18 16 M10.4 5.3A9.6 9.6 0 0 1 12 5.2c6.1 0 9.8 6.8 9.8 6.8a18.4 18.4 0 0 1-3.7 4.4 M6.3 7.6A18.2 18.2 0 0 0 2.2 12S5.9 18.8 12 18.8a9.5 9.5 0 0 0 3.5-.7 M9.8 10.3a3 3 0 0 0 4 4.2',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  close: 'M6 6l12 12 M18 6L6 18',
};

export type NavIconName = keyof typeof paths;

interface Props {
  name: NavIconName;
  /**
   * Square edge. A number is pixels. A CSS length works too, so an icon beside
   * text that scales with the screen can scale with it.
   */
  size?: number | string;
  /** Give this only when the icon carries meaning no nearby words carry. */
  label?: string;
  /** Add `icon-in-heading` to sit an icon on the baseline of a heading. */
  className?: string;
}

export default function NavIcon({ name, size = 20, label, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false"
      className={className ? `nav-icon ${className}` : 'nav-icon'}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      {label ? <title>{label}</title> : null}
      <path d={paths[name]} />
    </svg>
  );
}
