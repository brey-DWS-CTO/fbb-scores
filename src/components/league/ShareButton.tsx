import { useEffect, useState } from 'react';
import NavIcon from './NavIcon.js';

interface Props {
  url: string;
  title: string;
  className?: string;
}

/**
 * Share a link. On a phone this opens the share sheet; elsewhere it copies
 * the link and says so for a moment.
 */
export default function ShareButton({ url, title, className }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const share = async () => {
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ url, title });
        return;
      } catch {
        /* closed the sheet, or no sheet: fall through to copying */
      }
    }
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
    } catch {
      window.prompt('Copy this link', url);
    }
  };

  return (
    <button type="button" className={`tap-btn mock-mini-btn share-btn${className ? ` ${className}` : ''}`} onClick={() => void share()}>
      <NavIcon name="share" size="1em" />
      {copied ? 'LINK COPIED' : 'SHARE'}
    </button>
  );
}
