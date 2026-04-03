import React, { useState, useRef } from 'react';
import { FiUpload, FiFile, FiCheckCircle, FiAlertCircle, FiPackage, FiBox, FiAnchor } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { uploadExcel, uploadContainerExtra, uploadImport } from '../services/api';

const TABS = [
  { id: 'BULK', label: 'Bulk Stock', icon: <FiPackage /> },
  { id: 'CONTAINER_EXTRA', label: 'Container Extra', icon: <FiBox /> },
  { id: 'IMPORT', label: 'Import', icon: <FiAnchor /> }
];

const COLUMN_HELP = {
  BULK: 'Fish Name, Size, Bulk Weight (KG), Type, Glazing, CS In Date, Sticker, Lines / Place, Stack No, Stack Total, Hand On Balance',
  CONTAINER_EXTRA: 'Order, Fish Name, Size, Packed size, Production/Packed Date, Expiration Date, Balance MC, St No, Line, Remark',
  IMPORT: 'Fish Name, Size, KG, MC, Total KG, Arrival Date, Country, LINE, Invoice No, Remark'
};

function ExcelUpload() {
  const [activeTab, setActiveTab] = useState('BULK');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setFile(null);
    setResult(null);
  };

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (f) setFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const handleUpload = async () => {
    if (!file) {
      toast.warning('Please select a file first');
      return;
    }
    setUploading(true);
    setResult(null);
    try {
      const uploadFn = activeTab === 'CONTAINER_EXTRA' ? uploadContainerExtra : activeTab === 'IMPORT' ? uploadImport : uploadExcel;
      const res = await uploadFn(file);
      setResult(res.data);
      toast.success(`Import completed: ${res.data.imported} rows imported`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
      setResult({ error: err.response?.data?.error || 'Upload failed' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2><FiUpload /> Excel Upload</h2>
      </div>
      <div className="page-body">
        <div className="stock-type-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`stock-type-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div className="card" style={{ maxWidth: 700 }}>
          <div className="card-header">
            <h3>Import {activeTab === 'CONTAINER_EXTRA' ? 'Container Extra' : activeTab === 'IMPORT' ? 'Import Stock' : 'Bulk Stock'} Data from Excel</h3>
          </div>
          <div className="card-body">
            <div className="alert alert-info">
              Your Excel file should have these columns (in any order):
              <br/><strong>{COLUMN_HELP[activeTab]}</strong>
            </div>

            <div
              className={`upload-area ${dragOver ? 'drag-over' : ''}`}
              onClick={() => fileRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                ref={fileRef}
                onChange={handleFileChange}
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
              />
              {file ? (
                <>
                  <FiFile style={{ fontSize: '2.5rem', color: 'var(--success)' }} />
                  <h4>{file.name}</h4>
                  <p>{(file.size / 1024).toFixed(1)} KB</p>
                </>
              ) : (
                <>
                  <FiUpload style={{ fontSize: '2.5rem' }} />
                  <h4>Click or drag Excel file here</h4>
                  <p>Supports .xlsx, .xls, .csv files (max 10MB)</p>
                </>
              )}
            </div>

            <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={!file || uploading}
              >
                <FiUpload /> {uploading ? 'Uploading...' : 'Upload & Import'}
              </button>
              {file && (
                <button className="btn btn-outline" onClick={() => { setFile(null); setResult(null); }}>
                  Clear
                </button>
              )}
            </div>

            {result && !result.error && (
              <div style={{ marginTop: 20 }}>
                <div className="alert alert-success">
                  <FiCheckCircle />
                  <div>
                    <strong>Import Successful!</strong><br/>
                    Total Rows: {result.total_rows} | Imported: {result.imported} | Skipped: {result.skipped}
                    {result.total_mc_imported != null && (
                      <><br/>Total MC in stock (this file): {Number(result.total_mc_imported).toLocaleString()}</>
                    )}
                    {(result.products_created > 0 || result.products_reused > 0) && (
                      <><br/>Products — New: {result.products_created}, Existing (reused): {result.products_reused}</>
                    )}
                    {(result.locations_created > 0 || result.locations_reused > 0) && (
                      <><br/>Locations — New: {result.locations_created}, Existing (reused): {result.locations_reused}</>
                    )}
                  </div>
                </div>
                {result.errors && result.errors.length > 0 && (
                  <div className="alert alert-warning">
                    <FiAlertCircle />
                    <div>
                      <strong>Some rows had issues:</strong>
                      <ul style={{ margin: '8px 0 0 16px', fontSize: '0.82rem' }}>
                        {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {result && result.error && (
              <div className="alert alert-error" style={{ marginTop: 20 }}>
                <FiAlertCircle />
                <div><strong>Error:</strong> {result.error}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default ExcelUpload;
