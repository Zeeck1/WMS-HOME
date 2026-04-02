import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import {
  FiGrid, FiPackage, FiMapPin, FiArrowDownCircle,
  FiArrowUpCircle, FiTable, FiUpload, FiClock,
  FiMenu, FiX, FiChevronLeft, FiLayers, FiList,
  FiShoppingCart, FiSettings, FiBarChart2, FiBook, FiAlertTriangle, FiTrendingDown, FiCalendar, FiUsers, FiUserCheck, FiClipboard, FiCpu, FiAnchor, FiShield, FiLogOut
} from 'react-icons/fi';

import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Locations from './pages/Locations';
import StockIn from './pages/StockIn';
import StockOut from './pages/StockOut';
import StockTable from './pages/StockTable';
import StockChart from './pages/StockChart';
import ExcelUpload from './pages/ExcelUpload';
import Movements from './pages/Movements';
import LocationLayout from './pages/LocationLayout';
import Withdraw from './pages/Withdraw';
import WithdrawForm from './pages/WithdrawForm';
import WithdrawReport from './pages/WithdrawReport';
import Manage from './pages/Manage';
import Manual from './pages/Manual';
import LinesReformat from './pages/LinesReformat';
import CustomerMaster from './pages/CustomerMaster';
import CustomerStock from './pages/CustomerStock';
import CustomerPrint from './pages/CustomerPrint';
import CustomerSummary from './pages/CustomerSummary';
import NoMovementStocks from './pages/NoMovementStocks';
import LowSafetyStocks from './pages/LowSafetyStocks';
import Calendar from './pages/Calendar';
import Settings from './pages/Settings';
import CKIntelligence from './pages/CKIntelligence';
import CKIntelligenceChat from './pages/CKIntelligenceChat';
import OrderAvailabilityChecker from './pages/OrderAvailabilityChecker';
import OACResult from './pages/OACResult';
import ImportShipments from './pages/ImportShipments';
import ImportShipmentDetail from './pages/ImportShipmentDetail';
import UserManagement from './pages/UserManagement';
import logoThaiBg from './images/logo-thai-bg.jpg';

/** Sidebar groups for superadmin; permission users see one "Overview" with all allowed links in this order. */
const SIDEBAR_SECTIONS = [
  {
    title: 'Overview',
    items: [
      { to: '/', Icon: FiGrid, label: 'Dashboard', pageKey: 'dashboard', end: true },
      { to: '/stock-table', Icon: FiTable, label: 'Stock Summary', pageKey: 'stock-table' },
      { to: '/ck-intelligence', Icon: FiCpu, label: 'CK Intelligence', pageKey: 'ck-intelligence' },
    ],
  },
  {
    title: 'Master Data',
    items: [
      { to: '/products', Icon: FiPackage, label: 'Product Master', pageKey: 'products' },
      { to: '/locations', Icon: FiMapPin, label: 'Location Master', pageKey: 'locations' },
      { to: '/customer-master', Icon: FiUsers, label: 'Customer Stock Master', pageKey: 'customer-master' },
    ],
  },
  {
    title: 'Customer',
    items: [
      { to: '/customer', Icon: FiUserCheck, label: 'Customer', pageKey: 'customer' },
      { to: '/customer-summary', Icon: FiClipboard, label: 'Summary', pageKey: 'customer-summary' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/stock-in', Icon: FiArrowDownCircle, label: 'Stock IN', pageKey: 'stock-in' },
      { to: '/stock-out', Icon: FiArrowUpCircle, label: 'Stock OUT', pageKey: 'stock-out' },
      { to: '/imports', Icon: FiAnchor, label: 'Import Stock', pageKey: 'imports' },
      { to: '/withdraw', Icon: FiShoppingCart, label: 'Withdraw', pageKey: 'withdraw' },
      { to: '/manage', Icon: FiSettings, label: 'Manage', pageKey: 'manage' },
      { to: '/manual', Icon: FiBook, label: 'Manual', pageKey: 'manual' },
      { to: '/lines-reformat', Icon: FiList, label: 'Lines Re-format', pageKey: 'lines-reformat' },
      { to: '/movements', Icon: FiClock, label: 'Movement History', pageKey: 'movements' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { to: '/stock-chart', Icon: FiBarChart2, label: 'Stock Chart', pageKey: 'stock-chart' },
      { to: '/location-layout', Icon: FiLayers, label: 'Location Layout', pageKey: 'location-layout' },
      { to: '/no-movement', Icon: FiAlertTriangle, label: 'No-Movement (+3M)', pageKey: 'no-movement' },
      { to: '/low-safety-stocks', Icon: FiTrendingDown, label: 'Low/Safety Stocks', pageKey: 'low-safety-stocks' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { to: '/oac', Icon: FiClipboard, label: 'Order Checker (OAC)', pageKey: 'oac' },
      { to: '/upload', Icon: FiUpload, label: 'Excel Upload', pageKey: 'upload' },
      { to: '/calendar', Icon: FiCalendar, label: 'Calendar', pageKey: 'calendar' },
      { to: '/settings', Icon: FiSettings, label: 'Settings', pageKey: 'settings' },
    ],
  },
];

// Protected route wrapper
function Protected({ pageKey, children }) {
  const { hasAccess } = useAuth();
  if (!hasAccess(pageKey)) return <Navigate to="/" replace />;
  return children;
}

// Sidebar wrapper that auto-closes on mobile route change and filters by permissions
function SidebarNav({ collapsed, mobileOpen, onNavClick }) {
  const location = useLocation();
  const { hasAccess, user } = useAuth();

  useEffect(() => {
    if (mobileOpen) onNavClick();
    // eslint-disable-next-line
  }, [location.pathname]);

  const link = (to, icon, label, pageKey, end) => {
    if (!hasAccess(pageKey)) return null;
    return (
      <NavLink key={pageKey} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        {icon}
        <span className="nav-label">{label}</span>
      </NavLink>
    );
  };

  const renderNavItem = (item) => {
    const Icon = item.Icon;
    return link(item.to, <Icon />, item.label, item.pageKey, item.end);
  };

  const isSuperadmin = user?.role === 'superadmin';
  const flatNavItems = SIDEBAR_SECTIONS.flatMap((s) => s.items);

  return (
    <nav className="sidebar-nav">
      {isSuperadmin ? (
        <>
          {SIDEBAR_SECTIONS.map((section) => (
            <React.Fragment key={section.title}>
              <div className="nav-section-title"><span>{section.title}</span></div>
              {section.items.map((item) => renderNavItem(item))}
            </React.Fragment>
          ))}
          <div className="nav-section-title"><span>Admin</span></div>
          <NavLink to="/user-management" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <FiShield />
            <span className="nav-label">Permissions</span>
          </NavLink>
        </>
      ) : (
        <>
          <div className="nav-section-title"><span>Overview</span></div>
          {flatNavItems.map((item) => renderNavItem(item))}
        </>
      )}
    </nav>
  );
}

function AppShell() {
  const { user, loading, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const handleResize = useCallback(() => {
    const mobile = window.innerWidth <= 768;
    setIsMobile(mobile);
    if (!mobile) setMobileOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  const toggleSidebar = () => {
    if (isMobile) {
      setMobileOpen(prev => !prev);
    } else {
      setCollapsed(prev => !prev);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div>Loading...</div>;
  }

  if (!user) {
    return <Login />;
  }

  const sidebarClass = [
    'sidebar',
    collapsed && !isMobile ? 'collapsed' : '',
    isMobile && mobileOpen ? 'mobile-open' : '',
    isMobile && !mobileOpen ? 'mobile-closed' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={`app-layout ${collapsed && !isMobile ? 'sidebar-collapsed' : ''}`}>
      {isMobile && mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={sidebarClass}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="brand-icon">W</div>
            <div className="brand-text">
              <h1>WMS</h1>
              <p>Warehouse Management</p>
            </div>
          </div>
          {!isMobile && (
            <button className="collapse-btn" onClick={toggleSidebar} title={collapsed ? 'Expand' : 'Collapse'}>
              <FiChevronLeft />
            </button>
          )}
          {isMobile && (
            <button className="collapse-btn" onClick={() => setMobileOpen(false)}>
              <FiX />
            </button>
          )}
        </div>
        <SidebarNav collapsed={collapsed} mobileOpen={mobileOpen} onNavClick={() => setMobileOpen(false)} />
        <div className="sidebar-footer">
          <div className="sidebar-user-info">
            <img
              src={logoThaiBg}
              alt=""
              className="sidebar-user-avatar"
              decoding="async"
            />
            <div className="sidebar-user-text">
              <span className="sidebar-user-name">{user.display_name || user.username}</span>
              <span className="sidebar-user-role">{user.role === 'superadmin' ? 'Admin' : 'User'}</span>
            </div>
          </div>
          <button className="sidebar-logout-btn" onClick={logout} title="Sign out">
            <FiLogOut />
            <span className="nav-label">Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="topbar">
          {isMobile && (
            <button className="topbar-menu-btn" onClick={toggleSidebar}>
              <FiMenu />
            </button>
          )}
          <div className="topbar-title">
            {isMobile && <span className="topbar-brand">WMS</span>}
          </div>
          <div className="topbar-user">
            <span className="topbar-username">{user.display_name || user.username}</span>
            <button className="topbar-logout" onClick={logout} title="Sign out"><FiLogOut /></button>
          </div>
        </div>

        <div className="main-scroll">
          <Routes>
            <Route path="/" element={<Protected pageKey="dashboard"><Dashboard /></Protected>} />
            <Route path="/ck-intelligence" element={<Protected pageKey="ck-intelligence"><CKIntelligence /></Protected>} />
            <Route path="/ck-intelligence-chat" element={<Protected pageKey="ck-intelligence"><CKIntelligenceChat /></Protected>} />
            <Route path="/products" element={<Protected pageKey="products"><Products /></Protected>} />
            <Route path="/locations" element={<Protected pageKey="locations"><Locations /></Protected>} />
            <Route path="/stock-in" element={<Protected pageKey="stock-in"><StockIn /></Protected>} />
            <Route path="/stock-out" element={<Protected pageKey="stock-out"><StockOut /></Protected>} />
            <Route path="/stock-table" element={<Protected pageKey="stock-table"><StockTable /></Protected>} />
            <Route path="/manual" element={<Protected pageKey="manual"><Manual /></Protected>} />
            <Route path="/lines-reformat" element={<Protected pageKey="lines-reformat"><LinesReformat /></Protected>} />
            <Route path="/customer-master" element={<Protected pageKey="customer-master"><CustomerMaster /></Protected>} />
            <Route path="/customer" element={<Protected pageKey="customer"><CustomerStock /></Protected>} />
            <Route path="/customer/print/:depositId/:withdrawalId" element={<Protected pageKey="customer"><CustomerPrint /></Protected>} />
            <Route path="/customer-summary" element={<Protected pageKey="customer-summary"><CustomerSummary /></Protected>} />
            <Route path="/stock-chart" element={<Protected pageKey="stock-chart"><StockChart /></Protected>} />
            <Route path="/upload" element={<Protected pageKey="upload"><ExcelUpload /></Protected>} />
            <Route path="/withdraw" element={<Protected pageKey="withdraw"><Withdraw /></Protected>} />
            <Route path="/withdraw/:id/form" element={<Protected pageKey="withdraw"><WithdrawForm /></Protected>} />
            <Route path="/withdraw/:id/report" element={<Protected pageKey="withdraw"><WithdrawReport /></Protected>} />
            <Route path="/manage" element={<Protected pageKey="manage"><Manage /></Protected>} />
            <Route path="/movements" element={<Protected pageKey="movements"><Movements /></Protected>} />
            <Route path="/location-layout" element={<Protected pageKey="location-layout"><LocationLayout /></Protected>} />
            <Route path="/no-movement" element={<Protected pageKey="no-movement"><NoMovementStocks /></Protected>} />
            <Route path="/low-safety-stocks" element={<Protected pageKey="low-safety-stocks"><LowSafetyStocks /></Protected>} />
            <Route path="/calendar" element={<Protected pageKey="calendar"><Calendar /></Protected>} />
            <Route path="/imports" element={<Protected pageKey="imports"><ImportShipments /></Protected>} />
            <Route path="/imports/new" element={<Protected pageKey="imports"><ImportShipmentDetail /></Protected>} />
            <Route path="/imports/:id" element={<Protected pageKey="imports"><ImportShipmentDetail /></Protected>} />
            <Route path="/oac" element={<Protected pageKey="oac"><OrderAvailabilityChecker /></Protected>} />
            <Route path="/oac-result/:id" element={<Protected pageKey="oac"><OACResult /></Protected>} />
            <Route path="/settings" element={<Protected pageKey="settings"><Settings /></Protected>} />
            {user?.role === 'superadmin' && (
              <Route path="/user-management" element={<UserManagement />} />
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppShell />
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          pauseOnHover
          theme="colored"
        />
      </AuthProvider>
    </Router>
  );
}

export default App;
