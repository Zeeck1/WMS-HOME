import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import {
  FiGrid, FiPackage, FiMapPin, FiArrowDownCircle,
  FiArrowUpCircle, FiTable, FiUpload, FiClock,
  FiMenu, FiX, FiChevronLeft, FiLayers, FiList,
  FiShoppingCart, FiSettings, FiBarChart2, FiBook, FiAlertTriangle, FiTrendingDown, FiCalendar, FiUsers, FiUserCheck, FiClipboard, FiCpu
} from 'react-icons/fi';

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
import OrderAvailabilityChecker from './pages/OrderAvailabilityChecker';
import OACResult from './pages/OACResult';

// Sidebar wrapper that auto-closes on mobile route change
function SidebarNav({ collapsed, mobileOpen, onNavClick }) {
  const location = useLocation();

  useEffect(() => {
    // Close mobile sidebar on route change
    if (mobileOpen) onNavClick();
    // eslint-disable-next-line
  }, [location.pathname]);

  const link = (to, icon, label, end) => (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
      {icon}
      <span className="nav-label">{label}</span>
    </NavLink>
  );

  return (
    <nav className="sidebar-nav">
      <div className="nav-section-title"><span>Overview</span></div>
      {link('/', <FiGrid />, 'Dashboard', true)}
      {link('/ck-intelligence', <FiCpu />, 'CK Intelligence')}

      <div className="nav-section-title"><span>Master Data</span></div>
      {link('/products', <FiPackage />, 'Product Master')}
      {link('/locations', <FiMapPin />, 'Location Master')}
      {link('/customer-master', <FiUsers />, 'Customer Stock Master')}

      <div className="nav-section-title"><span>Customer</span></div>
      {link('/customer', <FiUserCheck />, 'Customer')}
      {link('/customer-summary', <FiClipboard />, 'Summary')}

      <div className="nav-section-title"><span>Operations</span></div>
      {link('/stock-in', <FiArrowDownCircle />, 'Stock IN')}
      {link('/stock-out', <FiArrowUpCircle />, 'Stock OUT')}
      {link('/withdraw', <FiShoppingCart />, 'Withdraw')}
      {link('/manage', <FiSettings />, 'Manage')}
      {link('/manual', <FiBook />, 'Manual')}
      {link('/lines-reformat', <FiList />, 'Lines Re-format')}
      {link('/movements', <FiClock />, 'Movement History')}

      <div className="nav-section-title"><span>Reports</span></div>
      {link('/stock-table', <FiTable />, 'Stock Table')}
      {link('/stock-chart', <FiBarChart2 />, 'Stock Chart')}
      {link('/location-layout', <FiLayers />, 'Location Layout')}
      {link('/no-movement', <FiAlertTriangle />, 'No-Movement (+3M)')}
      {link('/low-safety-stocks', <FiTrendingDown />, 'Low/Safety Stocks')}

      <div className="nav-section-title"><span>Tools</span></div>
      {link('/oac', <FiClipboard />, 'Order Checker (OAC)')}
      {link('/upload', <FiUpload />, 'Excel Upload')}
      {link('/calendar', <FiCalendar />, 'Calendar')}
      {link('/settings', <FiSettings />, 'Settings')}
    </nav>
  );
}

function App() {
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

  const sidebarClass = [
    'sidebar',
    collapsed && !isMobile ? 'collapsed' : '',
    isMobile && mobileOpen ? 'mobile-open' : '',
    isMobile && !mobileOpen ? 'mobile-closed' : ''
  ].filter(Boolean).join(' ');

  return (
    <Router>
      <div className={`app-layout ${collapsed && !isMobile ? 'sidebar-collapsed' : ''}`}>
        {/* Mobile overlay */}
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
            <p>v1.0.0</p>
          </div>
        </aside>

        <main className="main-content">
          {/* Top bar */}
          <div className="topbar">
            {isMobile && (
              <button className="topbar-menu-btn" onClick={toggleSidebar}>
                <FiMenu />
              </button>
            )}
            <div className="topbar-title">
              {isMobile && <span className="topbar-brand">WMS</span>}
            </div>
          </div>

          <div className="main-scroll">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/ck-intelligence" element={<CKIntelligence />} />
              <Route path="/products" element={<Products />} />
              <Route path="/locations" element={<Locations />} />
              <Route path="/stock-in" element={<StockIn />} />
              <Route path="/stock-out" element={<StockOut />} />
              <Route path="/stock-table" element={<StockTable />} />
              <Route path="/manual" element={<Manual />} />
              <Route path="/lines-reformat" element={<LinesReformat />} />
              <Route path="/customer-master" element={<CustomerMaster />} />
              <Route path="/customer" element={<CustomerStock />} />
              <Route path="/customer/print/:depositId/:withdrawalId" element={<CustomerPrint />} />
              <Route path="/customer-summary" element={<CustomerSummary />} />
              <Route path="/stock-chart" element={<StockChart />} />
              <Route path="/upload" element={<ExcelUpload />} />
              <Route path="/withdraw" element={<Withdraw />} />
              <Route path="/withdraw/:id/form" element={<WithdrawForm />} />
              <Route path="/withdraw/:id/report" element={<WithdrawReport />} />
              <Route path="/manage" element={<Manage />} />
              <Route path="/movements" element={<Movements />} />
              <Route path="/location-layout" element={<LocationLayout />} />
              <Route path="/no-movement" element={<NoMovementStocks />} />
              <Route path="/low-safety-stocks" element={<LowSafetyStocks />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/oac" element={<OrderAvailabilityChecker />} />
              <Route path="/oac-result/:id" element={<OACResult />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </main>
      </div>

      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        theme="colored"
      />
    </Router>
  );
}

export default App;
