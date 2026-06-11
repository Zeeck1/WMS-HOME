import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  FiLogIn, FiUser, FiLock, FiEye, FiEyeOff,
  FiPackage, FiLayers, FiTruck, FiClipboard, FiShield,
  FiHash, FiClock, FiArrowLeft
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
  const { login, employeeLogin, pendingApproval, clearPendingApproval } = useAuth();
  const [mode, setMode] = useState('password'); // 'password' | 'employee'

  // Password login state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  // Employee login state
  const [empId, setEmpId] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const switchMode = (m) => {
    setMode(m);
    setError('');
    clearPendingApproval();
  };

  const handlePasswordSubmit = async (e) => {
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

  const handleEmployeeSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await employeeLogin(empId.trim());
      if (result?.status === 'pending') return;
    } catch (err) {
      const msg = err.response?.data?.error;
      if (msg === 'PENDING_APPROVAL') return;
      setError(msg || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const background = (
    <div className="login-sky" aria-hidden="true">
      <div className="login-starfield login-starfield--slow" />
      <div className="login-starfield login-starfield--mid" />
      <div className="login-starfield login-starfield--fast" />
      <div className="login-twinkle" />
      <div className="login-meteor login-meteor--a" />
      <div className="login-meteor login-meteor--b" />
      <div className="login-aurora" />
    </div>
  );

  const floatingCards = (
    <div className="login-floating-cards" aria-hidden="true">
      {WMS_INFO_CARDS.map((card, i) => {
        const Icon = card.icon;
        return (
          <div key={card.title} className={`login-wms-card login-wms-card--${i + 1}`}>
            <div className="login-wms-card-icon"><Icon /></div>
            <h3 className="login-wms-card-title">{card.title}</h3>
            <p className="login-wms-card-text">{card.text}</p>
          </div>
        );
      })}
    </div>
  );

  // Pending approval waiting screen
  if (pendingApproval) {
    return (
      <div className="login-page">
        {background}
        {floatingCards}
        <div className="login-card login-pending-card">
          <div className="login-brand">
            <div className="login-brand-icon">
              <img src={logoThai} alt="CK Frozen" className="login-brand-logo" />
            </div>
            <h1>WMS</h1>
            <p>Warehouse Management System</p>
          </div>
          <div className="login-pending-body">
            <div className="login-pending-icon"><FiClock /></div>
            <h3 className="login-pending-title">Waiting for Approval</h3>
            <p className="login-pending-name">{pendingApproval.display_name}</p>
            <p className="login-pending-desc">
              Your account has been registered and is awaiting superadmin approval.<br />
              Once approved, you will be able to access the system.
            </p>
            <p className="login-pending-th">
              บัญชีของคุณกำลังรอการอนุมัติจากผู้ดูแลระบบ<br />
              กรุณารอสักครู่แล้วลองใหม่อีกครั้ง
            </p>
            <button className="login-btn login-btn-outline" onClick={() => clearPendingApproval()}>
              <FiArrowLeft /> Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      {background}
      {floatingCards}

      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-icon">
            <img src={logoThai} alt="CK Frozen" className="login-brand-logo" />
          </div>
          <h1>WMS</h1>
          <p>Warehouse Management System</p>
        </div>

        {/* Mode tabs */}
        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab ${mode === 'password' ? 'login-tab--active' : ''}`}
            onClick={() => switchMode('password')}
          >
            <FiLock style={{ marginRight: 6 }} /> Username
          </button>
          <button
            type="button"
            className={`login-tab ${mode === 'employee' ? 'login-tab--active' : ''}`}
            onClick={() => switchMode('employee')}
          >
            <FiHash style={{ marginRight: 6 }} /> Employee ID
          </button>
        </div>

        {mode === 'password' ? (
          <form onSubmit={handlePasswordSubmit} className="login-form">
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
        ) : (
          <form onSubmit={handleEmployeeSubmit} className="login-form">
            <p className="login-emp-hint">กรอกรหัสพนักงานเพื่อเข้าสู่ระบบ</p>
            <div className="login-field">
              <FiHash className="login-field-icon" />
              <input
                type="text"
                placeholder="รหัสพนักงาน (Employee ID)"
                value={empId}
                onChange={e => setEmpId(e.target.value)}
                autoFocus
                required
              />
            </div>

            {error && <div className="login-error">{error}</div>}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? <span className="login-spinner" /> : <FiLogIn />}
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default Login;
