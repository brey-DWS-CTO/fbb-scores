import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import NavIcon from './NavIcon.js';
import SignaturePad from './SignaturePad.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  fetchDraftRulebookPdf,
  fetchRulebookSignatures,
  rulebookPdfUrl,
  signRulebook,
  type RulebookSignaturesResponse,
} from '../../lib/league/api.js';
import { describeSignatures, signatureStatus } from '../../lib/league/rulebookSignatures.js';

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

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
  // Bumped after a signature lands, so the pages redraw with it on the back.
  const [generation, setGeneration] = useState(0);

  // ── Signing, at the bottom of the printed copy ──
  const [signatures, setSignatures] = useState<RulebookSignaturesResponse | null>(null);
  const [mode, setMode] = useState<'idle' | 'draw'>('idle');
  // The sign panel sits under the bar and opens from the SIGN button.
  const [signOpen, setSignOpen] = useState(false);
  const [drawing, setDrawing] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  // The neon theme lays scanlines over the whole screen. Over white pages
  // they read as a printer fault, so they go while this page is open.
  useEffect(() => {
    document.body.classList.add('paper-open');
    return () => document.body.classList.remove('paper-open');
  }, []);

  const loadSignatures = useCallback(async () => {
    try {
      setSignatures(await fetchRulebookSignatures());
    } catch {
      setSignatures(null);
    }
  }, []);
  useEffect(() => {
    if (!draft && !rev) void loadSignatures();
  }, [draft, rev, loadSignatures]);

  const mine = identity && signatures ? signatures.signed.find((s) => s.owner === identity.owner) : undefined;
  const canSignHere =
    !draft &&
    !rev &&
    identity !== null &&
    signatures !== null &&
    signatures.versionId !== null &&
    signatures.versionId === signatures.currentVersionId &&
    signatures.fingerprint !== null &&
    !mine;

  const sign = async (withDrawing: string | null) => {
    if (!identity || !signatures?.currentVersionId || !signatures.fingerprint) return;
    setSigning(true);
    setSignError(null);
    try {
      await signRulebook(identity, signatures.currentVersionId, signatures.fingerprint, withDrawing);
      await loadSignatures();
      setMode('idle');
      setDrawing(null);
      setSignOpen(false);
      setGeneration((n) => n + 1);
    } catch (e) {
      setSignError(apiErrorMessage(e));
    } finally {
      setSigning(false);
    }
  };

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
        // Width follows the column and height follows the page's own shape,
        // so a narrower screen than the one measured never stretches a page.
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.setAttribute('aria-label', `Page ${n} of ${doc.numPages}`);
        host.appendChild(canvas);
        const context = canvas.getContext('2d');
        if (!context) continue;
        // 'print' draws straight through instead of waiting on animation
        // frames, which a background tab never gets. Same picture either way.
        await page.render({ canvas, canvasContext: context, viewport, intent: 'print' }).promise;
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
  }, [draft, rev, identity?.owner, generation]);

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
        {canSignHere && (
          <button
            type="button"
            className="rule-edit-save tap-btn paper-jump-sign"
            aria-expanded={signOpen}
            onClick={() => {
              setSignOpen((open) => !open);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            {signOpen ? 'CLOSE' : 'SIGN'}
          </button>
        )}
        {!draft && (
          <a className="rules-tool tap-btn rules-pdf-link" href={fileUrl} target="_blank" rel="noopener">
            <span aria-hidden="true">⤓</span> SAVE OR PRINT
          </a>
        )}
      </header>
      {!draft && !rev && signatures && signatures.versionId && (signOpen || mine || !identity) && (
        <section id="sign" className="panel sign-block paper-sign">
          <div className="sign-head">
            <span className="hub-heading sign-title">SIGN REVISION {signatures.revision}</span>
            <span className="sign-count">
              {describeSignatures(signatureStatus(signatures.members, signatures.signed, signatures.versionId))}
            </span>
          </div>
          <p className="sign-ack">&ldquo;{signatures.acknowledgement}&rdquo;</p>

          {mine && (
            <p className="sign-line sign-mine">
              You signed revision {mine.revision} on {formatDay(mine.signedAt)}
              {mine.drawn ? ', by hand' : ''}. It is on the last page.
            </p>
          )}
          {!identity && !mine && <p className="sign-line">Sign in from the home page to sign.</p>}

          {canSignHere && mode === 'idle' && (
            <div className="sign-actions paper-sign-actions">
              <button
                type="button"
                className="rule-edit-save tap-btn"
                disabled={signing}
                onClick={() => sign(null)}
              >
                {signing ? 'SIGNING...' : 'SIGN WITH MY NAME'}
              </button>
              <button type="button" className="rules-tool tap-btn" disabled={signing} onClick={() => setMode('draw')}>
                DRAW MY SIGNATURE
              </button>
              <span className="rule-edit-hint">
                Either one records your name and the time on this revision. A drawn signature prints on the
                signature page.
              </span>
            </div>
          )}

          {canSignHere && mode === 'draw' && (
            <div className="paper-sign-draw">
              <SignaturePad onChange={setDrawing} />
              <div className="sign-actions">
                <button
                  type="button"
                  className="rule-edit-save tap-btn"
                  disabled={signing || !drawing}
                  onClick={() => sign(drawing)}
                >
                  {signing ? 'SIGNING...' : 'I AGREE, SIGN IT'}
                </button>
                <button
                  type="button"
                  className="rule-edit-cancel tap-btn"
                  disabled={signing}
                  onClick={() => {
                    setMode('idle');
                    setDrawing(null);
                  }}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {signError && <p className="rules-draft-error">{signError}</p>}
        </section>
      )}
      {status === 'loading' && <p className="paper-note">Laying out the pages...</p>}
      {status === 'error' && <p className="rules-draft-error">{error}</p>}
      <div ref={holder} className="paper-sheets" />

    </main>
  );
}
