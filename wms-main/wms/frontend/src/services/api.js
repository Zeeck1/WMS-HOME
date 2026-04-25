import axios from 'axios';

const API_BASE = (() => {
  // Highest priority: explicit environment value from Railway.
  if (process.env.REACT_APP_API_URL) return process.env.REACT_APP_API_URL;

  // Local development.
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:5000/api';
  }

  // Production fallback for your current Railway setup.
  return 'https://wms-home-production.up.railway.app/api';
})();

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' }
});

/** Merge Bearer token from localStorage so secured routes work even if defaults are not set yet. */
function withAuth(config = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('wms_token') : null;
  if (!token) return config;
  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  };
}

// ─── Products ─────────────────────────────────────────
export const getProducts = (params) => api.get('/products', { params });
export const getProduct = (id) => api.get(`/products/${id}`);
export const createProduct = (data) => api.post('/products', data);
export const updateProduct = (id, data) => api.put(`/products/${id}`, data);
export const deleteProduct = (id) => api.delete(`/products/${id}`);
export const deleteAllProducts = (params) => api.delete('/products', { params });

// ─── Locations ────────────────────────────────────────
export const getLocations = () => api.get('/locations');
export const getLocation = (id) => api.get(`/locations/${id}`);
export const createLocation = (data) => api.post('/locations', data);
export const updateLocation = (id, data) => api.put(`/locations/${id}`, data);
export const deleteLocation = (id) => api.delete(`/locations/${id}`);
export const deleteAllLocations = () => api.delete('/locations');

// ─── Lots ─────────────────────────────────────────────
export const getLots = (params) => api.get('/lots', { params });
export const getLot = (id) => api.get(`/lots/${id}`);
export const createLot = (data) => api.post('/lots', data);
export const updateLot = (id, data) => api.put(`/lots/${id}`, data);
export const updateLotCsInDate = (id, cs_in_date) => api.patch(`/lots/${id}`, { cs_in_date });

// ─── Movements ────────────────────────────────────────
export const getMovements = (params) => api.get('/movements', { params });
export const stockIn = (data) => api.post('/movements/stock-in', data);
export const stockOut = (data) => api.post('/movements/stock-out', data);
export const adjustInventoryBalance = (data) => api.post('/movements/adjust', data);

// ─── Inventory ────────────────────────────────────────
export const getInventory = (params) => api.get('/inventory', { params });
export const getDashboard = () => api.get('/inventory/dashboard');
export const deleteAllStockData = (params) => api.delete('/inventory/all', { params });

// ─── Withdrawals ──────────────────────────────────────
export const getWithdrawals = (params) => api.get('/withdrawals', { params });
export const getWithdrawal = (id) => api.get(`/withdrawals/${id}`);
export const createWithdrawal = (data) => api.post('/withdrawals', data);
export const updateWithdrawalItems = (id, data) => api.put(`/withdrawals/${id}/items`, data);
export const updateWithdrawalStatus = (id, data) => api.put(`/withdrawals/${id}/status`, data);
export const cancelWithdrawal = (id) => api.delete(`/withdrawals/${id}`);
/** Superadmin: remove request and all linked stock-out / import-out rows everywhere */
export const permanentlyDeleteWithdrawal = (id) => api.delete(`/withdrawals/${id}/erase`, withAuth());

// ─── Upload ───────────────────────────────────────────
export const uploadExcel = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

export const uploadContainerExtra = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/upload/container-extra', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

export const uploadImport = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/upload/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

// ─── Reports ─────────────────────────────────────────
export const getLowStockStocks = (params) => api.get('/reports/low-stock', { params });
export const getNoMovementStocks = (params) => api.get('/reports/no-movement', { params });
export const sendLineNotification = (data) => api.post('/reports/no-movement/send-line', data);
export const sendEmailReport = (data) => api.post('/reports/no-movement/send-email', data);

// ─── Manual (spreadsheet editing) ────────────────────
export const manualUpdateCell = (data) => api.patch('/manual/cell', data);
export const manualDeleteRow = (lot_id, location_id) => api.delete('/manual/row', { params: { lot_id, location_id } });
export const manualAddRow = (data) => api.post('/manual/row', data);
export const manualReformat = (changes) => api.put('/manual/reformat', { changes });

// ─── OAC (Order Availability Checker) ────────────────
export const checkOrderAvailability = (files) => {
  const formData = new FormData();
  files.forEach(f => formData.append('files', f));
  return api.post('/oac/check', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

export const getOacChecks = (limit) => api.get('/oac/checks', { params: { limit } });
export const getOacCheck = (id) => api.get(`/oac/checks/${id}`);
export const deleteOacCheck = (id) => api.delete(`/oac/checks/${id}`);
export const getOacStockSummary = () => api.get('/oac/stock-summary');
/** All saved order lines from OAC Excel uploads (paged) */
export const getOacOrderLines = (params) => api.get('/oac/order-lines', { params });
/** Distinct order file per check — list for Orders tab */
export const getOacOrderGroups = (params) => api.get('/oac/order-groups', { params });

// ─── Imports (Shipments) ─────────────────────────────
export const getImportShipments = () => api.get('/imports');
export const getImportStockTable = () => api.get('/imports/stock-table');
export const getImportMovementHistory = (params) => api.get('/imports/movement-history', { params });
export const getImportShipment = (id) => api.get(`/imports/${id}`);
export const createImportShipment = (data) => api.post('/imports', data);
export const updateImportShipment = (id, data) => api.put(`/imports/${id}`, data);
export const deleteImportShipment = (id) => api.delete(`/imports/${id}`);
export const createImportStockOut = (shipmentId, data) => api.post(`/imports/${shipmentId}/stock-out`, data);
export const updateImportStockOut = (outId, data) => api.put(`/imports/stock-out/${outId}`, data);
export const deleteImportStockOut = (outId) => api.delete(`/imports/stock-out/${outId}`);

// ─── Settings ────────────────────────────────────────
export const getSettings = () => api.get('/settings');
export const saveSettings = (data) => api.put('/settings', data);
export const getSettingsUploads = () => api.get('/settings/uploads', withAuth());
export const deleteSettingsUploads = (filenames) =>
  api.delete('/settings/uploads', withAuth({ data: { filenames } }));

// ─── Backup / Restore ───────────────────────────────
export const exportBackup = () => api.get('/backup/export', withAuth({ responseType: 'blob' }));
export const importBackup = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/backup/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,
  });
};

// ─── Customers ───────────────────────────────────────
export const getCustomers = () => api.get('/customers');
export const getCustomer = (id) => api.get(`/customers/${id}`);
export const createCustomer = (data) => api.post('/customers', data);
export const updateCustomer = (id, data) => api.put(`/customers/${id}`, data);
export const deleteCustomer = (id) => api.delete(`/customers/${id}`);

export const getCustomerDeposits = (id) => api.get(`/customers/${id}/deposits`);
export const getDeposit = (depositId) => api.get(`/customers/deposits/${depositId}`);
export const createDeposit = (customerId, data) => api.post(`/customers/${customerId}/deposits`, data);
export const deleteAllDeposits = (customerId) => api.delete(`/customers/${customerId}/deposits`);

export const getCustomerDepositItems = (id, params) => api.get(`/customers/${id}/deposit-items`, { params });
export const getCustomerWithdrawals = (id) => api.get(`/customers/${id}/withdrawals`);
export const getWithdrawalDetail = (wId) => api.get(`/customers/withdrawals/${wId}`);
export const createCustomerWithdrawal = (customerId, data) => api.post(`/customers/${customerId}/withdrawals`, data);
export const deleteAllWithdrawals = (customerId) => api.delete(`/customers/${customerId}/withdrawals`);

export const getCustomerPrintData = (depositId, withdrawalId) => api.get(`/customers/print/${depositId}/${withdrawalId}`);
export const getCustomerSummary = (params) => api.get('/customers/summary/all', { params });
export const getDepositItemDetail = (depositItemId) => api.get(`/customers/summary/detail/${depositItemId}`);

// ─── CK Intelligence / Gemini ───────────────────────
export const geminiChat = (messages) => api.post('/gemini/chat', { messages });

// ─── Auth ────────────────────────────────────────────
export const login = (data) => api.post('/auth/login', data);
export const getMe = () => api.get('/auth/me');

// ─── Users (superadmin) ──────────────────────────────
export const getUsers = () => api.get('/users');
export const createUser = (data) => api.post('/users', data);
export const updateUser = (id, data) => api.put(`/users/${id}`, data);
export const deleteUser = (id) => api.delete(`/users/${id}`);

export default api;
