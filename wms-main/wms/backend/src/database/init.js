/**
 * Database Initialization Script
 * Run: npm run db:init
 * Creates all tables and views if they don't exist
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function getDbInitConfig() {
  const connectionUrl = process.env.DB_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (connectionUrl) {
    const parsed = new URL(connectionUrl);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username || process.env.DB_USER || process.env.MYSQLUSER || 'root'),
      password: decodeURIComponent(parsed.password || process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || ''),
      dbName: decodeURIComponent((parsed.pathname || '').replace(/^\//, '')) || process.env.DB_NAME || process.env.MYSQLDATABASE || 'wms_db'
    };
  }

  return {
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    dbName: process.env.DB_NAME || process.env.MYSQLDATABASE || 'wms_db'
  };
}

async function initDatabase() {
  let connection;
  try {
    const { host, port, user, password, dbName } = getDbInitConfig();

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

    // Location Master: one row per line_place — merge duplicate lines, drop (line+stack) unique
    try {
      const [dupGroups] = await connection.query(`
        SELECT UPPER(TRIM(line_place)) AS lp,
          GROUP_CONCAT(id ORDER BY is_active DESC, updated_at DESC, id ASC) AS ids
        FROM locations
        GROUP BY UPPER(TRIM(line_place))
        HAVING COUNT(*) > 1
      `);
      for (const g of dupGroups) {
        const ids = String(g.ids).split(',').map((x) => parseInt(x, 10)).filter(Boolean);
        const keeperId = ids[0];
        const [wiTable] = await connection.query(`
          SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_items'
        `, [dbName]);
        for (let i = 1; i < ids.length; i++) {
          await connection.query(
            'UPDATE movements SET location_id = ? WHERE location_id = ?',
            [keeperId, ids[i]]
          );
          if (wiTable.length > 0) {
            await connection.query(
              'UPDATE withdraw_items SET location_id = ? WHERE location_id = ?',
              [keeperId, ids[i]]
            );
          }
          await connection.query('DELETE FROM locations WHERE id = ?', [ids[i]]);
        }
        console.log(`  Merged duplicate location rows for ${g.lp} → id ${keeperId} (old rows deleted)`);
      }

      const [hasStackUq] = await connection.query(`
        SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'locations' AND CONSTRAINT_NAME = 'uq_line_place_stack'
      `, [dbName]);
      if (hasStackUq.length > 0) {
        await connection.query('ALTER TABLE locations DROP INDEX uq_line_place_stack');
        console.log('  Dropped uq_line_place_stack (line + stack unique)');
      }

      const [hasLineUq] = await connection.query(`
        SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'locations' AND CONSTRAINT_NAME = 'uq_line_place'
      `, [dbName]);
      if (hasLineUq.length === 0) {
        await connection.query('ALTER TABLE locations ADD UNIQUE KEY uq_line_place (line_place)');
        console.log('  Added uq_line_place (one row per line_place)');
      }
    } catch (e) {
      console.error('  Migration locations line_place unique:', e.message);
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS lots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lot_no VARCHAR(50) NOT NULL UNIQUE,
        lot_no_numeric BIGINT UNSIGNED DEFAULT NULL,
        cs_in_date DATE NOT NULL,
        sticker VARCHAR(100) DEFAULT NULL,
        product_id INT NOT NULL,
        notes TEXT DEFAULT NULL,
        production_date DATE DEFAULT NULL,
        expiration_date DATE DEFAULT NULL,
        st_no VARCHAR(50) DEFAULT NULL,
        remark TEXT DEFAULT NULL,
        country VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON UPDATE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: lots');

    // Migration: add country to lots (Import Excel origin)
    try {
      const [countryCols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'lots' AND COLUMN_NAME = 'country'
      `, [dbName]);
      if (countryCols.length === 0) {
        await connection.query('ALTER TABLE lots ADD COLUMN country VARCHAR(100) DEFAULT NULL AFTER remark');
        console.log('  Migration: added country to lots');
      }
    } catch (e) {
      // ignore
    }

    // Migration: numeric Lot No for Stock Summary / Manual (digits only)
    try {
      const [lnnCols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'lots' AND COLUMN_NAME = 'lot_no_numeric'
      `, [dbName]);
      if (lnnCols.length === 0) {
        await connection.query(
          "ALTER TABLE lots ADD COLUMN lot_no_numeric BIGINT UNSIGNED DEFAULT NULL COMMENT 'Lot No digits only' AFTER lot_no"
        );
        console.log('  Migration: added lot_no_numeric to lots');
      }
    } catch (e) {
      // ignore
    }

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
        l.lot_no_numeric,
        l.cs_in_date,
        l.sticker,
        l.production_date,
        l.expiration_date,
        l.st_no,
        l.remark,
        l.country,
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
        department ENUM('PK','RM','Branch.05 (SM)') NOT NULL,
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

    // Migration: allow Branch.05 (SM) on existing installs
    try {
      const [dCol] = await connection.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'department'`,
        [dbName]
      );
      const ct = dCol[0] && String(dCol[0].COLUMN_TYPE);
      if (ct && !ct.includes('Branch.05')) {
        await connection.query(
          `ALTER TABLE withdraw_requests MODIFY COLUMN department ENUM('PK','RM','Branch.05 (SM)') NOT NULL`
        );
        console.log('  Migration: withdraw_requests.department extended with Branch.05 (SM)');
      }
    } catch (e) {
      // ignore migration errors
    }

    // Migration: pick route (FIFO / nearest) save + undo backup on withdraw_requests
    try {
      const [prCols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'pick_route_mode'
      `, [dbName]);
      if (prCols.length === 0) {
        await connection.query(
          `ALTER TABLE withdraw_requests
           ADD COLUMN pick_route_mode VARCHAR(20) DEFAULT NULL AFTER managed_by,
           ADD COLUMN pick_route_backup JSON DEFAULT NULL AFTER pick_route_mode`
        );
        console.log('  Migration: pick_route_mode / pick_route_backup on withdraw_requests');
      }
    } catch (e) {
      console.error('  Migration pick_route columns:', e.message);
    }

    // Migration: dispatcher name (entered at Ready to Take on Manage page)
    try {
      const [dispCols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'dispatcher'
      `, [dbName]);
      if (dispCols.length === 0) {
        await connection.query(
          'ALTER TABLE withdraw_requests ADD COLUMN dispatcher VARCHAR(100) DEFAULT NULL AFTER managed_by'
        );
        console.log('  Migration: dispatcher on withdraw_requests');
      }
    } catch (e) {
      console.error('  Migration dispatcher column:', e.message);
    }

    // Migration: manual_adjust flag (superadmin adjusts cartons without stock deduction)
    try {
      const [maCols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'manual_adjust'
      `, [dbName]);
      if (maCols.length === 0) {
        await connection.query(
          'ALTER TABLE withdraw_requests ADD COLUMN manual_adjust TINYINT(1) NOT NULL DEFAULT 0 AFTER dispatcher'
        );
        console.log('  Migration: manual_adjust on withdraw_requests');
      }
    } catch (e) {
      console.error('  Migration manual_adjust column:', e.message);
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
        kg_parts VARCHAR(500) DEFAULT NULL,
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
        kg_parts_out VARCHAR(500) DEFAULT NULL,
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

    // Migration: import shipment lines on withdraw (import_item_id; lot/location nullable)
    try {
      const [impW] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_items' AND COLUMN_NAME = 'import_item_id'
      `, [dbName]);
      if (impW.length === 0) {
        await connection.query('ALTER TABLE withdraw_items ADD COLUMN import_item_id INT NULL DEFAULT NULL AFTER request_id');
        await connection.query('ALTER TABLE withdraw_items ADD COLUMN import_stock_out_id INT NULL DEFAULT NULL AFTER movement_id');
        await connection.query('ALTER TABLE withdraw_items MODIFY lot_id INT NULL');
        await connection.query('ALTER TABLE withdraw_items MODIFY location_id INT NULL');
        await connection.query(
          'ALTER TABLE withdraw_items ADD CONSTRAINT fk_wi_import_item FOREIGN KEY (import_item_id) REFERENCES import_items(id) ON DELETE CASCADE'
        );
        await connection.query(
          'ALTER TABLE withdraw_items ADD CONSTRAINT fk_wi_import_stock_out FOREIGN KEY (import_stock_out_id) REFERENCES import_stock_outs(id) ON DELETE SET NULL'
        );
        console.log('  Migration: import_item_id / import_stock_out_id and nullable lot/location on withdraw_items');
      }
    } catch (e) {
      console.error('  Migration withdraw_items import columns:', e.message);
    }

    // Migration: snapshot columns on withdraw_items (permanent FINISHED line data)
    try {
      const [snapCol] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_items' AND COLUMN_NAME = 'snap_fish_name'
      `, [dbName]);
      if (snapCol.length === 0) {
        await connection.query(`
          ALTER TABLE withdraw_items
            ADD COLUMN snap_fish_name VARCHAR(255) NULL DEFAULT NULL AFTER production_process,
            ADD COLUMN snap_size VARCHAR(100) NULL DEFAULT NULL AFTER snap_fish_name,
            ADD COLUMN snap_lot_no VARCHAR(100) NULL DEFAULT NULL AFTER snap_size,
            ADD COLUMN snap_lot_no_numeric INT NULL DEFAULT NULL AFTER snap_lot_no,
            ADD COLUMN snap_cs_in_date DATE NULL DEFAULT NULL AFTER snap_lot_no_numeric,
            ADD COLUMN snap_line_place VARCHAR(100) NULL DEFAULT NULL AFTER snap_cs_in_date,
            ADD COLUMN snap_stack_no VARCHAR(50) NULL DEFAULT NULL AFTER snap_line_place,
            ADD COLUMN snap_order_code VARCHAR(100) NULL DEFAULT NULL AFTER snap_stack_no,
            ADD COLUMN snap_stock_type VARCHAR(20) NULL DEFAULT NULL AFTER snap_order_code,
            ADD COLUMN snap_bulk_weight_kg DECIMAL(10,4) NULL DEFAULT NULL AFTER snap_stock_type,
            ADD COLUMN snap_type VARCHAR(50) NULL DEFAULT NULL AFTER snap_bulk_weight_kg,
            ADD COLUMN snap_glazing VARCHAR(50) NULL DEFAULT NULL AFTER snap_type,
            ADD COLUMN snap_sticker VARCHAR(100) NULL DEFAULT NULL AFTER snap_glazing,
            ADD COLUMN snap_import_inv_no VARCHAR(100) NULL DEFAULT NULL AFTER snap_sticker,
            ADD COLUMN snap_st_no VARCHAR(50) NULL DEFAULT NULL AFTER snap_import_inv_no,
            ADD COLUMN frozen_at TIMESTAMP NULL DEFAULT NULL AFTER snap_st_no
        `);
        console.log('  Migration: added snapshot columns to withdraw_items');
      }
    } catch (e) {
      console.error('  Migration withdraw_items snapshot columns:', e.message);
    }

    try {
      const [snapStNo] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_items' AND COLUMN_NAME = 'snap_st_no'
      `, [dbName]);
      if (snapStNo.length === 0) {
        await connection.query(
          'ALTER TABLE withdraw_items ADD COLUMN snap_st_no VARCHAR(50) NULL DEFAULT NULL AFTER snap_import_inv_no'
        );
        console.log('  Migration: added snap_st_no to withdraw_items');
      }
    } catch (e) {
      console.error('  Migration withdraw_items snap_st_no:', e.message);
    }

    // Migration: per-item stock-out mode for Manual Adjust (1=stock out, 0=no stock out, NULL=normal flow)
    try {
      const [msoCol] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_items' AND COLUMN_NAME = 'manual_stock_out'
      `, [dbName]);
      if (msoCol.length === 0) {
        await connection.query(
          'ALTER TABLE withdraw_items ADD COLUMN manual_stock_out TINYINT(1) NULL DEFAULT NULL AFTER production_process'
        );
        console.log('  Migration: added manual_stock_out to withdraw_items');
      }
    } catch (e) {
      console.error('  Migration withdraw_items manual_stock_out:', e.message);
    }

    // Migration: per-item print form actual columns visibility (1/NULL=show, 0=hide
    // Actual CTN / Net Weight / Time out on the print form; Process and Remark always print)
    try {
      const [safCol] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_items' AND COLUMN_NAME = 'show_actual_on_form'
      `, [dbName]);
      if (safCol.length === 0) {
        await connection.query(
          'ALTER TABLE withdraw_items ADD COLUMN show_actual_on_form TINYINT(1) NULL DEFAULT NULL AFTER manual_stock_out'
        );
        console.log('  Migration: added show_actual_on_form to withdraw_items');
      }
    } catch (e) {
      console.error('  Migration withdraw_items show_actual_on_form:', e.message);
    }

    // Migration: do not cascade-delete finished withdrawal lines when import items are removed
    try {
      const [fkRows] = await connection.query(`
        SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'withdraw_items' AND CONSTRAINT_NAME = 'fk_wi_import_item'
      `, [dbName]);
      if (fkRows.length > 0 && fkRows[0].DELETE_RULE === 'CASCADE') {
        await connection.query('ALTER TABLE withdraw_items DROP FOREIGN KEY fk_wi_import_item');
        await connection.query(
          'ALTER TABLE withdraw_items ADD CONSTRAINT fk_wi_import_item FOREIGN KEY (import_item_id) REFERENCES import_items(id) ON DELETE SET NULL'
        );
        console.log('  Migration: fk_wi_import_item ON DELETE SET NULL (preserve finished withdraw lines)');
      }
    } catch (e) {
      console.error('  Migration fk_wi_import_item delete rule:', e.message);
    }

    // Migration: allow lot/location master cleanup without deleting finished withdraw lines
    for (const col of ['lot_id', 'location_id']) {
      try {
        const [fkRows] = await connection.query(
          `SELECT rc.CONSTRAINT_NAME, rc.DELETE_RULE
           FROM information_schema.REFERENTIAL_CONSTRAINTS rc
           INNER JOIN information_schema.KEY_COLUMN_USAGE kcu
             ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
           WHERE rc.CONSTRAINT_SCHEMA = ? AND kcu.TABLE_NAME = 'withdraw_items' AND kcu.COLUMN_NAME = ?`,
          [dbName, col]
        );
        if (fkRows.length > 0 && fkRows[0].DELETE_RULE !== 'SET NULL') {
          const fkName = fkRows[0].CONSTRAINT_NAME;
          const refTable = col === 'lot_id' ? 'lots' : 'locations';
          await connection.query(`ALTER TABLE withdraw_items DROP FOREIGN KEY \`${fkName}\``);
          await connection.query(
            `ALTER TABLE withdraw_items ADD CONSTRAINT fk_wi_${col} FOREIGN KEY (${col}) REFERENCES ${refTable}(id) ON UPDATE CASCADE ON DELETE SET NULL`
          );
          console.log(`  Migration: withdraw_items.${col} ON DELETE SET NULL`);
        }
      } catch (e) {
        console.error(`  Migration withdraw_items.${col} delete rule:`, e.message);
      }
    }

    // Backfill snapshots for existing FINISHED withdrawals
    try {
      const { freezeWithdrawItemsSnapshot } = require('../utils/withdrawItemSnapshot');
      const [finishedReqs] = await connection.query(
        `SELECT id FROM withdraw_requests WHERE status = 'FINISHED'`
      );
      for (const row of finishedReqs) {
        await freezeWithdrawItemsSnapshot(connection, row.id);
      }
      if (finishedReqs.length > 0) {
        console.log(`  Migration: backfilled snapshots for ${finishedReqs.length} finished withdrawal(s)`);
      }
    } catch (e) {
      console.error('  Migration backfill finished withdraw snapshots:', e.message);
    }

    // Backfill: import_stock_outs created from withdrawals stored the request number
    // (WD-PK-YYYYMMDD-###). Replace it with Production Process (withdraw line) or Department.
    try {
      const [res] = await connection.query(`
        UPDATE import_stock_outs iso
        JOIN withdraw_items wi ON wi.import_stock_out_id = iso.id
        JOIN withdraw_requests wr ON wr.id = wi.request_id
        SET iso.order_ref = COALESCE(NULLIF(TRIM(wi.production_process), ''), wr.department)
        WHERE iso.order_ref = wr.request_no
           OR iso.order_ref LIKE 'WD-%'
      `);
      if (res && res.affectedRows > 0) {
        console.log(`  Migration: backfilled ${res.affectedRows} import_stock_outs.order_ref with production_process/department`);
      }
    } catch (e) {
      console.error('  Migration backfill import_stock_outs.order_ref:', e.message);
    }

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

    // Migration: kg_parts for comma-separated kg breakdown (Customer deposit IN)
    try {
      const [cols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customer_deposit_items' AND COLUMN_NAME = 'kg_parts'
      `, [dbName]);
      if (cols.length === 0) {
        await connection.query(
          'ALTER TABLE customer_deposit_items ADD COLUMN kg_parts VARCHAR(500) DEFAULT NULL AFTER weight_kg'
        );
        console.log('  Migration: added kg_parts to customer_deposit_items');
      }
    } catch (e) { /* ignore */ }

    // Migration: kg_parts_out on customer withdrawal lines (comma-separated, matches IN kg_parts)
    try {
      const [cols] = await connection.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customer_withdrawal_items' AND COLUMN_NAME = 'kg_parts_out'
      `, [dbName]);
      if (cols.length === 0) {
        await connection.query(
          'ALTER TABLE customer_withdrawal_items ADD COLUMN kg_parts_out VARCHAR(500) DEFAULT NULL AFTER weight_kg_out'
        );
        console.log('  Migration: added kg_parts_out to customer_withdrawal_items');
      }
    } catch (e) { /* ignore */ }

    // CK Intelligence — trained knowledge (company info, policies, etc.)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ck_knowledge_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category VARCHAR(64) NOT NULL DEFAULT 'general',
        title VARCHAR(512) NOT NULL,
        content TEXT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_ck_cat (category),
        KEY idx_ck_sort (sort_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Table created: ck_knowledge_entries');

    // ── Employee directory ───────────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id VARCHAR(50) NOT NULL UNIQUE,
        full_name VARCHAR(200) NOT NULL,
        position VARCHAR(200) DEFAULT NULL,
        division VARCHAR(100) DEFAULT NULL,
        department VARCHAR(100) DEFAULT NULL,
        work_location VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Table created: employees');

    // ── Auth: users & permissions ────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(100),
        role ENUM('superadmin','user') NOT NULL DEFAULT 'user',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        employee_id VARCHAR(50) DEFAULT NULL,
        approval_status ENUM('pending','approved') DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: users');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        page_key VARCHAR(100) NOT NULL,
        can_access TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uq_user_page (user_id, page_key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    console.log('  Table created: user_permissions');

    // Migrations: add columns to users if they don't exist yet
    const [userCols] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
      [process.env.DB_NAME || 'wms_db']
    );
    const userColNames = userCols.map((c) => c.COLUMN_NAME);
    if (!userColNames.includes('employee_id')) {
      await connection.query('ALTER TABLE users ADD COLUMN employee_id VARCHAR(50) DEFAULT NULL AFTER display_name');
      console.log('  Migration: added employee_id to users');
    }
    if (!userColNames.includes('approval_status')) {
      await connection.query("ALTER TABLE users ADD COLUMN approval_status ENUM('pending','approved') DEFAULT NULL AFTER employee_id");
      console.log('  Migration: added approval_status to users');
    }

    // Seed superadmin (skip if already exists)
    const bcrypt = require('bcryptjs');
    const [existing] = await connection.query("SELECT id FROM users WHERE username = 'Superadmin'");
    if (existing.length === 0) {
      const hash = await bcrypt.hash('ckfrozen123', 10);
      await connection.query(
        "INSERT INTO users (username, password_hash, display_name, role) VALUES ('Superadmin', ?, 'Super Admin', 'superadmin')",
        [hash]
      );
      console.log('  Seeded superadmin user');
    }

    // Remove leftover duplicate / unused location rows (old stack 555 etc.) from Location Master
    try {
      const { purgeDuplicateLocationsForLine, purgeUnusedLocationRows } = require('../utils/locationMaster');
      const [dupGroups] = await connection.query(`
        SELECT UPPER(TRIM(line_place)) AS lp,
          GROUP_CONCAT(id ORDER BY is_active DESC, updated_at DESC, id ASC) AS ids
        FROM locations
        GROUP BY UPPER(TRIM(line_place))
        HAVING COUNT(*) > 1
      `);
      for (const g of dupGroups) {
        const ids = String(g.ids).split(',').map((x) => parseInt(x, 10)).filter(Boolean);
        const keeperId = ids[0];
        const [keeper] = await connection.query('SELECT line_place FROM locations WHERE id = ?', [keeperId]);
        if (keeper.length) {
          await purgeDuplicateLocationsForLine(connection, keeperId, keeper[0].line_place);
        }
      }
      const purged = await purgeUnusedLocationRows(connection);
      if (purged > 0) {
        console.log(`  Purged ${purged} unused location row(s) from Location Master`);
      }
    } catch (e) {
      console.error('  Location Master cleanup:', e.message);
    }

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
