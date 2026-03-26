const mysql = require('mysql2/promise');
const { URL } = require('url');
require('dotenv').config();

function parseMysqlUrl(connectionUrl) {
  const parsed = new URL(connectionUrl);
  const dbName = decodeURIComponent((parsed.pathname || '').replace(/^\//, '')) || undefined;

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    database: dbName
  };
}

function getMysqlConfig() {
  // Railway often provides MYSQL_URL (and also split vars, depending on how you configure it).
  const connectionUrl = process.env.DB_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (connectionUrl) {
    const parsed = parseMysqlUrl(connectionUrl);
    // Keep a sensible default if the URL has no db name (rare, but helps local scripts).
    return {
      ...parsed,
      database: parsed.database || process.env.DB_NAME || process.env.MYSQLDATABASE || 'wms_db'
    };
  }

  return {
    host: process.env.DB_HOST || process.env.MYSQLHOST,
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'wms_db'
  };
}

const mysqlConfig = getMysqlConfig();
const isProduction = process.env.NODE_ENV === 'production';

// In production (Railway), fail fast instead of silently trying localhost.
if (isProduction) {
  if (!mysqlConfig.host) {
    throw new Error('Missing MySQL host. Set DB_HOST/ MYSQLHOST (or DB_URL/ MYSQL_URL).');
  }
}

const pool = mysql.createPool({
  ...mysqlConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true
});

module.exports = pool;
