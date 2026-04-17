import React, { useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import logoAi from '../images/logo_ai.png';

/** Seeded pseudo-random for stable star positions between renders */
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function CKIntelligence() {
  const navigate = useNavigate();

  useEffect(() => {
    document.body.classList.add('cki-route');
    return () => document.body.classList.remove('cki-route');
  }, []);

  const stars = useMemo(() => {
    const rand = seededRandom(42);
    return Array.from({ length: 120 }, (_, i) => ({
      id: i,
      left: `${rand() * 100}%`,
      top: `${rand() * 100}%`,
      size: rand() * 2 + 0.5,
      delay: `${rand() * 4}s`,
      duration: `${2 + rand() * 3}s`,
    }));
  }, []);

  const bigStars = useMemo(() => {
    const rand = seededRandom(99);
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: `${rand() * 100}%`,
      top: `${rand() * 100}%`,
      delay: `${rand() * 5}s`,
    }));
  }, []);

  return (
    <div className="cki-page">
      <div className="cki-aurora" aria-hidden="true" />
      <div className="cki-grid" aria-hidden="true" />

      <div className="cki-stars-layer">
        {stars.map((s) => (
          <span
            key={s.id}
            className="cki-star"
            style={{
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              animationDelay: s.delay,
              animationDuration: s.duration,
            }}
          />
        ))}
      </div>

      <div className="cki-stars-bright">
        {bigStars.map((s) => (
          <span key={s.id} className="cki-star-bright" style={{ left: s.left, top: s.top, animationDelay: s.delay }} />
        ))}
      </div>

      <div className="cki-content">
        <div className="cki-logo-wrap">
          <div className="cki-float-logo" aria-hidden="true">
            <div className="cki-float-ring" />
            <div className="cki-float-inner">
              <img src={logoAi} alt="CK Intelligence" className="cki-logo-img" />
            </div>
          </div>
          <div className="cki-brand-block">
            <h1 className="cki-title">CK Intelligence</h1>
            <p className="cki-tagline">Warehouse insights &amp; analytics — powered by CK</p>
          </div>
        </div>

        <div className="cki-actions-row">
          <button
            type="button"
            className="cki-explore-btn"
            onClick={() => navigate('/ck-intelligence-chat')}
          >
            <span className="cki-coming-glow" aria-hidden="true" />
            <span className="cki-coming-text">Explore Now</span>
          </button>
        </div>

        <p className="cki-footnote">We&apos;re building something stellar for your operations.</p>
      </div>
    </div>
  );
}

export default CKIntelligence;
