/**
 * Database Initialization Script
 * Run: npm run db:init
 * Creates all tables and views if they don't exist
 */
const mysql = require('mysql2/promise');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function parseMysqlUrl(connectionUrl) {
  const parsed = new URL(connectionUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    database: decodeURIComponent((parsed.pathname || '').replace(/^\//, '')) || undefined
  };
}

function getMysqlInitConfig() {
  const connectionUrl = process.env.DB_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (connectionUrl) {
    const parsed = parseMysqlUrl(connectionUrl);
    return {
      host: parsed.host,
      port: parsed.port,
      user: parsed.user,
      password: parsed.password,
      dbName: parsed.database || process.env.DB_NAME || process.env.MYSQLDATABASE || 'wms_db'
    };
  }

  return {
    host: process.env.DB_HOST || process.env.MYSQLHOST,
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    dbName: process.env.DB_NAME || process.env.MYSQLDATABASE || 'wms_db'
  };
}

async function initDatabase() {
  let connection;
  try {
    const mysqlInit = getMysqlInitConfig();
    const { host, port, user, password, dbName } = mysqlInit;

    if (process.env.NODE_ENV === 'production' && !host) {
      throw new Error('Missing MySQL host for init. Set DB_HOST/ MYSQLHOST (or DB_URL/ MYSQL_URL).');
    }

    // Step 1: Connect without database to create it
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      multipleStatements: true
    });

    console.log('Connected to MySQL server.');

    // Step 2: Create database
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${dbName}\``);
    console.log(`Using database: ${dbName}`);

    // Step 3: Create tables directly
    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fish_name VARCHAR(100) NOT NULL,
        size VARCHAR(50) NOT NULL,
        bulk_weight_kg DECIMAL(10,2) NOT NULL DEFAULT 0,
        type VARCHAR(50) DEFAULT NULL,
        glazing VARCHAR(50) DEFAULT NULL,
        stock_type ENUM('BULK','CONTAINER_EXTRA','IMPORT') NOT NULL DEFAULT 'BULK',
        order_code VARCHAR(50) DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_product (fish_name, size, type, glazing, stock_type, order_code)
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: products');

    // Migration: add stock_type and order_code columns to products
    try {
      const [stCols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'stock_type'
      `, [dbName]);
      if (stCols.length === 0) {
        await connection.query("ALTER TABLE products ADD COLUMN stock_type ENUM('BULK','CONTAINER_EXTRA','IMPORT') NOT NULL DEFAULT 'BULK' AFTER glazing");
        await connection.query("ALTER TABLE products ADD COLUMN order_code VARCHAR(50) DEFAULT NULL AFTER stock_type");
        // Rebuild unique key to include stock_type and order_code
        try { await connection.query('ALTER TABLE products DROP INDEX uq_product'); } catch (e) { /* ignore */ }
        await connection.query('ALTER TABLE products ADD UNIQUE KEY uq_product (fish_name, size, type, glazing, stock_type, order_code)');
        console.log('  Migration: added stock_type, order_code to products');
      }
    } catch (e) {
      // ignore migration errors
    }

    // Migration: extend stock_type ENUM to include 'IMPORT'
    try {
      const [colInfo] = await connection.query(`
        SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'stock_type'
      `, [dbName]);
      if (colInfo.length > 0 && !colInfo[0].COLUMN_TYPE.includes('IMPORT')) {
        await connection.query("ALTER TABLE products MODIFY COLUMN stock_type ENUM('BULK','CONTAINER_EXTRA','IMPORT') NOT NULL DEFAULT 'BULK'");
        console.log('  Migration: extended stock_type ENUM to include IMPORT');
      }
    } catch (e) { /* ignore */ }

    // Location uniqueness is by line_place ONLY
    // The same location code (e.g. A03r-2) can hold many products but is ONE location
    await connection.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        line_place VARCHAR(20) NOT NULL UNIQUE,
        stack_no INT NOT NULL DEFAULT 1,
        stack_total INT NOT NULL DEFAULT 1,
        description VARCHAR(255) DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: locations');

    // Migrate: if old unique key exists on (line_place, stack_no), drop it
    try {
      const [keys] = await connection.query(`
        SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'locations' AND CONSTRAINT_NAME = 'uq_location'
      `, [dbName]);
      if (keys.length > 0) {
        await connection.query('ALTER TABLE locations DROP INDEX uq_location');
        console.log('  Dropped old uq_location index (line_place, stack_no)');
        // Add new unique on line_place only if not already there
        try {
          await connection.query('ALTER TABLE locations ADD UNIQUE KEY uq_line_place (line_place)');
          console.log('  Added new uq_line_place index (line_place only)');
        } catch (e) {
          // might already exist
        }
      }
    } catch (e) {
      // ignore migration errors
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS lots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lot_no VARCHAR(50) NOT NULL UNIQUE,
        cs_in_date DATE NOT NULL,
        sticker VARCHAR(100) DEFAULT NULL,
        product_id INT NOT NULL,
        notes TEXT DEFAULT NULL,
        production_date DATE DEFAULT NULL,
        expiration_date DATE DEFAULT NULL,
        st_no VARCHAR(50) DEFAULT NULL,
        remark TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON UPDATE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: lots');

    // Migration: add container-extra fields to lots
    try {
      const [pdCols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'lots' AND COLUMN_NAME = 'production_date'
      `, [dbName]);
      if (pdCols.length === 0) {
        await connection.query('ALTER TABLE lots ADD COLUMN production_date DATE DEFAULT NULL AFTER notes');
        await connection.query('ALTER TABLE lots ADD COLUMN expiration_date DATE DEFAULT NULL AFTER production_date');
        await connection.query('ALTER TABLE lots ADD COLUMN st_no VARCHAR(50) DEFAULT NULL AFTER expiration_date');
        await connection.query('ALTER TABLE lots ADD COLUMN remark TEXT DEFAULT NULL AFTER st_no');
        console.log('  Migration: added production_date, expiration_date, st_no, remark to lots');
      }
    } catch (e) {
      // ignore migration errors
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS movements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lot_id INT NOT NULL,
        location_id INT NOT NULL,
        quantity_mc INT NOT NULL DEFAULT 0,
        weight_kg DECIMAL(10,2) NOT NULL DEFAULT 0,
        movement_type ENUM('IN','OUT','MOVE') NOT NULL,
        reference_no VARCHAR(100) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_by VARCHAR(100) DEFAULT 'system',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lot_id) REFERENCES lots(id) ON UPDATE CASCADE,
        FOREIGN KEY (location_id) REFERENCES locations(id) ON UPDATE CASCADE,
        INDEX idx_movement_type (movement_type),
        INDEX idx_created_at (created_at),
        INDEX idx_lot (lot_id),
        INDEX idx_location (location_id)
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: movements');

    // Step 4: Create views
    await connection.query(`
      CREATE OR REPLACE VIEW inventory_view AS
      SELECT
        p.id AS product_id,
        p.fish_name,
        p.size,
        p.bulk_weight_kg,
        p.type,
        p.glazing,
        p.stock_type,
        p.order_code,
        l.id AS lot_id,
        l.lot_no,
        l.cs_in_date,
        l.sticker,
        l.production_date,
        l.expiration_date,
        l.st_no,
        l.remark,
        loc.id AS location_id,
        loc.line_place,
        loc.stack_no,
        loc.stack_total,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' AND DATE(m.created_at) < CURDATE() THEN m.quantity_mc ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' AND DATE(m.created_at) < CURDATE() THEN m.quantity_mc ELSE 0 END), 0)
        AS old_balance_mc,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' AND DATE(m.created_at) = CURDATE() THEN m.quantity_mc ELSE 0 END), 0)
        AS new_income_mc,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity_mc ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity_mc ELSE 0 END), 0)
        AS hand_on_balance_mc,
        COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.weight_kg ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.weight_kg ELSE 0 END), 0)
        AS hand_on_balance_kg
      FROM movements m
      JOIN lots l ON m.lot_id = l.id
      JOIN products p ON l.product_id = p.id
      JOIN locations loc ON m.location_id = loc.id
      GROUP BY p.id, l.id, loc.id
      HAVING hand_on_balance_mc > 0
    `);
    console.log('  View created: inventory_view');

    // Withdraw requests table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS withdraw_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_no VARCHAR(50) NOT NULL UNIQUE,
        department ENUM('PK','RM') NOT NULL,
        status ENUM('PENDING','TAKING_OUT','READY','FINISHED','CANCELLED') NOT NULL DEFAULT 'PENDING',
        withdraw_date DATE DEFAULT NULL,
        request_time TIME DEFAULT NULL,
        finished_at TIMESTAMP NULL DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        requested_by VARCHAR(100) DEFAULT 'system',
        managed_by VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_department (department),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: withdraw_requests');

    // Migration: add withdraw_date, request_time, finished_at columns if not exist
    try {
      const [cols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'withdraw_date'
      `, [dbName]);
      if (cols.length === 0) {
        await connection.query('ALTER TABLE withdraw_requests ADD COLUMN withdraw_date DATE DEFAULT NULL AFTER status');
        await connection.query('ALTER TABLE withdraw_requests ADD COLUMN request_time TIME DEFAULT NULL AFTER withdraw_date');
        await connection.query('ALTER TABLE withdraw_requests ADD COLUMN finished_at TIMESTAMP NULL DEFAULT NULL AFTER request_time');
        console.log('  Migration: added withdraw_date, request_time, finished_at columns');
      }
    } catch (e) {
      // ignore migration errors
    }

    // Withdraw items table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS withdraw_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NOT NULL,
        lot_id INT NOT NULL,
        location_id INT NOT NULL,
        requested_mc INT NOT NULL DEFAULT 0,
        quantity_mc INT NOT NULL DEFAULT 0,
        weight_kg DECIMAL(10,2) NOT NULL DEFAULT 0,
        production_process VARCHAR(100) DEFAULT NULL,
        movement_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES withdraw_requests(id) ON DELETE CASCADE,
        FOREIGN KEY (lot_id) REFERENCES lots(id) ON UPDATE CASCADE,
        FOREIGN KEY (location_id) REFERENCES locations(id) ON UPDATE CASCADE,
        FOREIGN KEY (movement_id) REFERENCES movements(id) ON DELETE SET NULL,
        INDEX idx_request (request_id)
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: withdraw_items');

    // Migration: add requested_mc column if it doesn't exist
    try {
      const [cols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_items' AND COLUMN_NAME = 'requested_mc'
      `, [dbName]);
      if (cols.length === 0) {
        await connection.query('ALTER TABLE withdraw_items ADD COLUMN requested_mc INT NOT NULL DEFAULT 0 AFTER location_id');
        // Back-fill: set requested_mc = quantity_mc for existing rows
        await connection.query('UPDATE withdraw_items SET requested_mc = quantity_mc WHERE requested_mc = 0');
        console.log('  Migration: added requested_mc column to withdraw_items');
      }
    } catch (e) {
      // ignore migration errors
    }

    // Migration: add production_process column if not exist
    try {
      const [cols2] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_items' AND COLUMN_NAME = 'production_process'
      `, [dbName]);
      if (cols2.length === 0) {
        await connection.query('ALTER TABLE withdraw_items ADD COLUMN production_process VARCHAR(100) DEFAULT NULL AFTER weight_kg');
        console.log('  Migration: added production_process column to withdraw_items');
      }
    } catch (e) {
      // ignore migration errors
    }

    await connection.query(`
      CREATE OR REPLACE VIEW dashboard_summary AS
      SELECT
        COALESCE(SUM(hand_on_balance_mc), 0) AS total_mc,
        COALESCE(SUM(hand_on_balance_kg), 0) AS total_kg,
        COUNT(DISTINCT location_id) AS total_stacks
      FROM inventory_view
    `);
    console.log('  View created: dashboard_summary');

    // ── Customer stock tables ──────────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        document_no VARCHAR(100),
        phone VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: customers');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_deposits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        deposit_date DATE NOT NULL,
        doc_ref VARCHAR(100),
        receiver_name VARCHAR(255),
        inspector_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: customer_deposits');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_deposit_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        deposit_id INT NOT NULL,
        seq_no INT NOT NULL,
        receive_date DATE,
        item_name VARCHAR(255) NOT NULL,
        lot_no VARCHAR(100),
        boxes INT DEFAULT 0,
        weight_kg DECIMAL(12,2) DEFAULT 0,
        nw_unit DECIMAL(12,2) DEFAULT 0,
        time_str VARCHAR(50),
        remark TEXT,
        FOREIGN KEY (deposit_id) REFERENCES customer_deposits(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: customer_deposit_items');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_withdrawals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        withdraw_date DATE NOT NULL,
        doc_ref VARCHAR(100),
        withdrawer_name VARCHAR(255),
        inspector_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: customer_withdrawals');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_withdrawal_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        withdrawal_id INT NOT NULL,
        deposit_item_id INT NOT NULL,
        boxes_out INT DEFAULT 0,
        weight_kg_out DECIMAL(12,2) DEFAULT 0,
        time_str VARCHAR(50),
        remark TEXT,
        FOREIGN KEY (withdrawal_id) REFERENCES customer_withdrawals(id) ON DELETE CASCADE,
        FOREIGN KEY (deposit_item_id) REFERENCES customer_deposit_items(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: customer_withdrawal_items');

    // ── Import shipment tables ────────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS import_shipments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        inv_no VARCHAR(100) NOT NULL,
        container_no VARCHAR(100),
        seal_no VARCHAR(100),
        eta DATE,
        origin_country VARCHAR(100),
        production_date DATE,
        expiry_date DATE,
        last_update_stock DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: import_shipments');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS import_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        shipment_id INT NOT NULL,
        seq_no INT NOT NULL,
        item_name VARCHAR(200),
        size VARCHAR(100),
        pack VARCHAR(200),
        wet_mc DECIMAL(10,2) DEFAULT 0,
        inv_mc INT DEFAULT 0,
        inv_nw_kgs DECIMAL(12,2) DEFAULT 0,
        factory_mc INT DEFAULT 0,
        factory_nw_kgs DECIMAL(12,2) DEFAULT 0,
        remark TEXT,
        unit_price DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (shipment_id) REFERENCES import_shipments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: import_items');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS import_stock_outs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_id INT NOT NULL,
        date_out DATE NOT NULL,
        order_ref VARCHAR(100),
        mc INT DEFAULT 0,
        nw_kgs DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_id) REFERENCES import_items(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: import_stock_outs');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS import_expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        shipment_id INT NOT NULL,
        seq_no INT NOT NULL,
        expense_name VARCHAR(200),
        total_baht DECIMAL(12,2) DEFAULT 0,
        amount_usd_kgs DECIMAL(12,4) DEFAULT 0,
        amount_usd_kgs_expr VARCHAR(200) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (shipment_id) REFERENCES import_shipments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: import_expenses');

    // Migration: add total_net_weight to import_shipments
    try {
      const [cols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'import_shipments' AND COLUMN_NAME = 'total_net_weight'
      `, [dbName]);
      if (cols.length === 0) {
        await connection.query('ALTER TABLE import_shipments ADD COLUMN total_net_weight DECIMAL(12,2) DEFAULT 0 AFTER last_update_stock');
        console.log('  Migration: added total_net_weight to import_shipments');
      }
    } catch (e) { /* ignore */ }

    // Migration: add lines column to import_items
    try {
      const [cols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'import_items' AND COLUMN_NAME = 'lines'
      `, [dbName]);
      if (cols.length === 0) {
        await connection.query('ALTER TABLE import_items ADD COLUMN `lines` VARCHAR(200) DEFAULT NULL AFTER unit_price');
        console.log('  Migration: added lines to import_items');
      }
    } catch (e) { /* ignore */ }

    // Migration: add amount_usd_kgs_expr to import_expenses
    try {
      const [cols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'import_expenses' AND COLUMN_NAME = 'amount_usd_kgs_expr'
      `, [dbName]);
      if (cols.length === 0) {
        await connection.query('ALTER TABLE import_expenses ADD COLUMN amount_usd_kgs_expr VARCHAR(200) DEFAULT NULL AFTER amount_usd_kgs');
        console.log('  Migration: added amount_usd_kgs_expr to import_expenses');
      }
    } catch (e) { /* ignore */ }

    console.log('\nDatabase schema initialized successfully!');

  } catch (error) {
    console.error('Failed to initialize database:');
    console.error('  Error code:', error.code || 'N/A');
    console.error('  Message:', error.message || String(error));
    if (error.code === 'ECONNREFUSED') {
      console.error('\n  => MySQL server is not running. Please start MySQL first.');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('\n  => Wrong username or password. Check your backend/.env file.');
    }
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

initDatabase();
