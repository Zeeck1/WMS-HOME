const mysql = require('mysql2/promise');
require('dotenv').config();

if (!process.env.TZ) process.env.TZ = 'Asia/Bangkok';

function getDbConfig() {
  const connectionUrl = process.env.DB_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (connectionUrl) {
    const parsed = new URL(connectionUrl);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username || process.env.DB_USER || process.env.MYSQLUSER || 'root'),
      password: decodeURIComponent(parsed.password || process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || ''),
      database: decodeURIComponent((parsed.pathname || '').replace(/^\//, '')) || process.env.DB_NAME || process.env.MYSQLDATABASE || 'wms_db'
    };
  }

  return {
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'wms_db'
  };
}

const pool = mysql.createPool({
  ...getDbConfig(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true,
  timezone: '+07:00',
});

pool.on('connection', (connection) => {
  connection.query("SET SESSION time_zone = '+07:00'");
});

module.exports = pool;
