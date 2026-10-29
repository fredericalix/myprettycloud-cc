export default function LoginPage() {
  return (
    <main className="login-root">
      {/* Decorative ambient light layer — purely visual. */}
      <div className="login-aurora" aria-hidden="true" />
      <section className="login-card">
        <div className="login-logo-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="login-logo"
            src="/icon.png"
            alt="myprettycloud"
            width={84}
            height={84}
          />
        </div>
        <div className="font-overtitle login-overtitle">Clever Cloud</div>
        <h1 className="login-title">myprettycloud</h1>
        <p className="login-sub">
          Your Clever Cloud infrastructure, as a living, SimCity-style world.
        </p>
        {/* Full-page nav (not fetch) so the OAuth redirect chain runs in the
            browser and the session cookie is set on return. */}
        <a href="/auth/login" className="login-cta">
          Sign in with Clever Cloud
          <span className="login-cta-arrow" aria-hidden="true">
            &rarr;
          </span>
        </a>
        <p className="login-foot">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          You&apos;ll be redirected to Clever Cloud to authorize access.
        </p>
      </section>
    </main>
  );
}
