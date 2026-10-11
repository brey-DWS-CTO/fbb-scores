import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import NavIcon from './NavIcon.js';
import { useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, fetchDraftRulebookPdf, rulebookPdfUrl } from '../../lib/league/api.js';

/**
 * The printed constitution, read inside the app.
 *
 * A phone will not show a PDF in a frame, and nobody downloads a file to
 * look at it on a phone. So the PDF is drawn page by page onto canvases, the
 * way a PDF reader does it, with the real file one tap away for anyone who
 * wants to save or print it. pdf.js loads only when this page opens; it is
 * large and the rest of the app never needs it.
 *
 *   /rules/paper            the published book
 *   /rules/paper?rev=<id>   a past revision
 *   /rules/paper?draft=1    the working draft (commissioner, needs a sign-in)
 */
export default function PaperPage() {
  const { identity } = useIdentity();
  const [params] = useSearchParams();
  const rev = params.get('rev');
  const draft = params.get('draft') === '1';
  const fileUrl = rulebookPdfUrl({ rev, copyFor: identity?.owner ?? null });

  const holder = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const host = holder.current;
    if (!host) return undefined;
    host.replaceChildren();
    setStatus('loading');
    setError(null);

    const run = async () => {
      // Fetch the bytes first: the draft needs the sign-in headers.
      let bytes: ArrayBuffer;
      if (draft) {
        if (!identity) throw new Error('Sign in to read the draft.');
        bytes = await (await fetchDraftRulebookPdf(identity)).arrayBuffer();
      } else {
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error('Could not load the rule book.');
        bytes = await response.arrayBuffer();
      }
      if (cancelled) return;

      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      if (cancelled) return;
      setPages(doc.numPages);

      // Draw at the holder's width, sharp on a high-density screen.
      const width = host.clientWidth || 360;
      const ratio = window.devicePixelRatio || 1;
      for (let n = 1; n <= doc.numPages; n += 1) {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const viewport = page.getViewport({ scale: scale * ratio });
        const canvas = document.createElement('canvas');
        canvas.className = 'paper-sheet';
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${base.height * scale}px`;
        canvas.setAttribute('aria-label', `Page ${n} of ${doc.numPages}`);
        host.appendChild(canvas);
        const context = canvas.getContext('2d');
        if (!context) continue;
        await page.render({ canvas, canvasContext: context, viewport }).promise;
      }
      if (!cancelled) setStatus('ready');
    };

    run().catch((e: unknown) => {
      if (cancelled) return;
      setStatus('error');
      setError(e instanceof Error && !('response' in e) ? e.message : apiErrorMessage(e));
    });
    return () => {
      cancelled = true;
    };
    // identity.owner is what the draft fetch and the copy stamp depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, rev, identity?.owner]);

  return (
    <main className="paper-page">
      <header className="paper-bar">
        <Link to={rev ? `/rules?rev=${encodeURIComponent(rev)}` : '/rules'} className="rules-tool tap-btn">
          <NavIcon name="book" size={14} className="icon-in-heading" />
          BACK TO THE RULES
        </Link>
        <span className="paper-title">
          {draft ? 'Draft, as it would print' : 'The printed constitution'}
          {pages ? ` · ${pages} pages` : ''}
        </span>
        {!draft && (
          <a className="rules-tool tap-btn rules-pdf-link" href={fileUrl} target="_blank" rel="noopener">
            <span aria-hidden="true">⤓</span> SAVE OR PRINT
          </a>
        )}
      </header>
      {status === 'loading' && <p className="paper-note">Laying out the pages...</p>}
      {status === 'error' && <p className="rules-draft-error">{error}</p>}
      <div ref={holder} className="paper-sheets" />
    </main>
  );
}
