const paths = {
  lock: 'M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  target: 'M22 12a10 10 0 1 1-10-10 10 10 0 0 1 10 10 M18 12a6 6 0 1 1-6-6 6 6 0 0 1 6 6 M14 12a2 2 0 1 1-2-2 2 2 0 0 1 2 2',
  people: 'M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M2 21v-3a6 6 0 0 1 12 0v3 M18 3a4 4 0 0 1 0 8 M18 15a4 4 0 0 1 4 4v2',
  arrows: 'M3 7h18 M17 3l4 4-4 4 M21 17H3 M7 13l-4 4 4 4',
  book: 'M12 5v16 M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1',
  ballot: 'M8 3h8v9H8z M10 7l2 2 3-4 M5 10l-3 5v6h20v-6l-3-5 M2 15h20',
  home: 'M3 10l9-8 9 8 M5 9v12h5v-7h4v7h5V9',
  trophy: 'M7 3h10v6a5 5 0 0 1-10 0z M7 5H3v3a4 4 0 0 0 4 4 M17 5h4v3a4 4 0 0 1-4 4 M12 14v7 M7 21h10',
  calendar: 'M3 5h18v16H3z M7 2v6 M17 2v6 M3 10h18 M7 14h2 M13 14h2 M7 18h2',
  shield: 'M12 2l9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6z M8 12l3 3 5-6',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  close: 'M6 6l12 12 M18 6L6 18',
};

export type NavIconName = keyof typeof paths;

export default function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      style={{ flexShrink: 0, verticalAlign: 'middle' }}>
      <path d={paths[name]} />
    </svg>
  );
}
