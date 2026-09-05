import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { consumeLoginToken, apiErrorMessage } from '../../lib/league/api.js';
import { leagueDataset } from '../../lib/league/data.js';

/**
 * /sign-in/:token — where an emailed link lands. Trade the token for a session
 * and get out of the way.
 */
export default function SignInLinkPage() {
  const { token } = useParams<{ token: string }>();
  const { signInWithSession } = useIdentity();
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A link works once. React runs this effect twice in development, and the
  // second run would burn the token and make a good link look dead.
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    consumeLoginToken(token)
      .then((result) => {
        signInWithSession(result);
        setSignedIn(true);
      })
      .catch((caught: unknown) => setError(apiErrorMessage(caught)));
  }, [token, signInWithSession]);

  // Home sends a signed-in owner straight on to their keeper worksheet.
  if (signedIn) return <Navigate to="/" replace />;

  const problem = token ? error : 'That link is missing its code. Ask for a new one.';

  return (
    <main className="splash-page">
      <div className="splash-orb splash-orb-teal" aria-hidden="true" />
      <div className="splash-orb splash-orb-purple" aria-hidden="true" />

      <div className="splash-shell">
        <header className="splash-hero">
          <div className="splash-season">FBB SCORES · THE NERDS · SEASON {leagueDataset.season}</div>
          <img className="splash-logo" src="/logo.png" alt="FBB Scores — The Nerds fantasy basketball league" />
        </header>

        <section className="panel splash-login-card" aria-labelledby="sign-in-link-title">
          <div className="splash-login-heading">
            <div>
              <div className="splash-step">OWNER ACCESS</div>
              <h2 id="sign-in-link-title">{problem ? 'That link did not work' : 'Signing you in…'}</h2>
            </div>
            <div className="splash-lock" aria-hidden="true">🔐</div>
          </div>

          {problem ? (
            <div className="identity-form">
              <div className="identity-error" role="alert">{problem}</div>
              <p className="identity-help">
                Links run out after 15 minutes and work once. Ask for a fresh one.
              </p>
              <Link className="tap-btn identity-submit identity-link-btn" to="/">
                BACK TO SIGN IN
              </Link>
            </div>
          ) : (
            <p className="identity-help">Hold on. This takes a second.</p>
          )}
        </section>
      </div>
    </main>
  );
}
