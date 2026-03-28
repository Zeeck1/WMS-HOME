import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  FiLogIn, FiUser, FiLock, FiEye, FiEyeOff,
  FiPackage, FiLayers, FiTruck, FiClipboard, FiShield
} from 'react-icons/fi';
import logoThai from '../images/logo-thai.png';

const WMS_INFO_CARDS = [
  {
    icon: FiPackage,
    title: 'Inventory at a glance',
    text: 'See stock by product, lot, and location in one place—built for frozen goods workflows.'
  },
  {
    icon: FiTruck,
    title: 'Movements & withdrawals',
    text: 'Track stock in, stock out, imports, and department withdrawals with a clear history trail.'
  },
  {
    icon: FiLayers,
    title: 'Locations & layout',
    text: 'Organize warehouse lines and stacks so teams know exactly where every lot lives.'
  },
  {
    icon: FiClipboard,
    title: 'Reports & insights',
    text: 'Stock tables, charts, no-movement alerts, and customer summaries to support decisions.'
  },
  {
    icon: FiShield,
    title: 'Controlled access',
    text: 'Role-based permissions so each user only sees the pages they need.'
  }
];

function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-sky" aria-hidden="true">
        <div className="login-starfield login-starfield--slow" />
        <div className="login-starfield login-starfield--mid" />
        <div className="login-starfield login-starfield--fast" />
        <div className="login-twinkle" />
        <div className="login-meteor login-meteor--a" />
        <div className="login-meteor login-meteor--b" />
        <div className="login-aurora" />
      </div>

      <div className="login-floating-cards" aria-hidden="true">
        {WMS_INFO_CARDS.map((card, i) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className={`login-wms-card login-wms-card--${i + 1}`}
            >
              <div className="login-wms-card-icon"><Icon /></div>
              <h3 className="login-wms-card-title">{card.title}</h3>
              <p className="login-wms-card-text">{card.text}</p>
            </div>
          );
        })}
      </div>

      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-icon">
            <img src={logoThai} alt="CK Frozen" className="login-brand-logo" />
          </div>
          <h1>WMS</h1>
          <p>Warehouse Management System</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <FiUser className="login-field-icon" />
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="login-field">
            <FiLock className="login-field-icon" />
            <input
              type={showPw ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            <button type="button" className="login-eye" onClick={() => setShowPw(!showPw)}>
              {showPw ? <FiEyeOff /> : <FiEye />}
            </button>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? <span className="login-spinner" /> : <FiLogIn />}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
