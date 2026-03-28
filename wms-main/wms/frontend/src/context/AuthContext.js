import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { login as loginApi, getMe } from '../services/api';

const AuthContext = createContext(null);

// All page keys that can be permissioned
export const ALL_PAGES = [
  { key: 'dashboard',        label: 'Dashboard',            path: '/' },
  { key: 'ck-intelligence',  label: 'CK Intelligence',      path: '/ck-intelligence' },
  { key: 'products',         label: 'Product Master',        path: '/products' },
  { key: 'locations',        label: 'Location Master',       path: '/locations' },
  { key: 'customer-master',  label: 'Customer Stock Master', path: '/customer-master' },
  { key: 'customer',         label: 'Customer',              path: '/customer' },
  { key: 'customer-summary', label: 'Summary',               path: '/customer-summary' },
  { key: 'stock-in',         label: 'Stock IN',              path: '/stock-in' },
  { key: 'stock-out',        label: 'Stock OUT',             path: '/stock-out' },
  { key: 'imports',          label: 'Import Stock',          path: '/imports' },
  { key: 'withdraw',         label: 'Withdraw',              path: '/withdraw' },
  { key: 'manage',           label: 'Manage',                path: '/manage' },
  { key: 'manual',           label: 'Manual',                path: '/manual' },
  { key: 'lines-reformat',   label: 'Lines Re-format',       path: '/lines-reformat' },
  { key: 'movements',        label: 'Movement History',      path: '/movements' },
  { key: 'stock-table',      label: 'Stock Table',           path: '/stock-table' },
  { key: 'stock-chart',      label: 'Stock Chart',           path: '/stock-chart' },
  { key: 'location-layout',  label: 'Location Layout',       path: '/location-layout' },
  { key: 'no-movement',      label: 'No-Movement (+3M)',     path: '/no-movement' },
  { key: 'low-safety-stocks',label: 'Low/Safety Stocks',     path: '/low-safety-stocks' },
  { key: 'oac',              label: 'Order Checker (OAC)',   path: '/oac' },
  { key: 'upload',           label: 'Excel Upload',          path: '/upload' },
  { key: 'calendar',         label: 'Calendar',              path: '/calendar' },
  { key: 'settings',         label: 'Settings',              path: '/settings' },
];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const applyToken = useCallback((token) => {
    if (token) {
      localStorage.setItem('wms_token', token);
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      localStorage.removeItem('wms_token');
      delete api.defaults.headers.common['Authorization'];
    }
  }, []);

  // On mount, check for existing token
  useEffect(() => {
    const token = localStorage.getItem('wms_token');
    if (!token) { setLoading(false); return; }

    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    getMe()
      .then(res => setUser(res.data))
      .catch(() => applyToken(null))
      .finally(() => setLoading(false));
  }, [applyToken]);

  const login = async (username, password) => {
    const res = await loginApi({ username, password });
    applyToken(res.data.token);
    setUser(res.data.user);
    return res.data.user;
  };

  const logout = () => {
    applyToken(null);
    setUser(null);
  };

  const hasAccess = (pageKey) => {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    return user.permissions?.includes(pageKey);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
