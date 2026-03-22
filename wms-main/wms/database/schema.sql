-- ============================================================
-- WMS - Warehouse Management System
-- MySQL Database Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS wms_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE wms_db;

-- ============================================================
-- 1. PRODUCTS TABLE - Fish product master data
-- ============================================================
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
) ENGINE=InnoDB;

-- ============================================================
-- 2. LOCATIONS TABLE - Warehouse lines / places / stacks
-- ============================================================
CREATE TABLE IF NOT EXISTS locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    line_place VARCHAR(20) NOT NULL COMMENT 'Location code e.g. A01R-1, A01L-1',
    stack_no INT NOT NULL DEFAULT 1,
    stack_total INT NOT NULL DEFAULT 1,
    description VARCHAR(255) DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_location (line_place, stack_no)
) ENGINE=InnoDB;

-- ============================================================
-- 3. LOTS TABLE - Lot / batch tracking
-- ============================================================
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
) ENGINE=InnoDB;

-- ============================================================
-- 4. MOVEMENTS TABLE - All stock movements (IN/OUT/MOVE)
-- ============================================================
CREATE TABLE IF NOT EXISTS movements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lot_id INT NOT NULL,
    location_id INT NOT NULL,
    quantity_mc INT NOT NULL DEFAULT 0 COMMENT 'Master cartons',
    weight_kg DECIMAL(10,2) NOT NULL DEFAULT 0,
    movement_type ENUM('IN','OUT','MOVE') NOT NULL,
    reference_no VARCHAR(100) DEFAULT NULL COMMENT 'PO, Invoice, Transfer ref',
    notes TEXT DEFAULT NULL,
    created_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lot_id) REFERENCES lots(id) ON UPDATE CASCADE,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON UPDATE CASCADE,
    INDEX idx_movement_type (movement_type),
    INDEX idx_created_at (created_at),
    INDEX idx_lot (lot_id),
    INDEX idx_location (location_id)
) ENGINE=InnoDB;

-- ============================================================
-- 5. INVENTORY VIEW - Calculated from movements (not stored)
--    Hand On Balance = SUM(IN) - SUM(OUT)
-- ============================================================
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
    -- Old Balance = all IN before today minus all OUT before today
    COALESCE(SUM(CASE WHEN m.movement_type = 'IN' AND DATE(m.created_at) < CURDATE() THEN m.quantity_mc ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' AND DATE(m.created_at) < CURDATE() THEN m.quantity_mc ELSE 0 END), 0)
    AS old_balance_mc,
    -- New Income = IN movements today
    COALESCE(SUM(CASE WHEN m.movement_type = 'IN' AND DATE(m.created_at) = CURDATE() THEN m.quantity_mc ELSE 0 END), 0)
    AS new_income_mc,
    -- Hand On Balance = total IN - total OUT (all time)
    COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity_mc ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity_mc ELSE 0 END), 0)
    AS hand_on_balance_mc,
    -- Total KG
    COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.weight_kg ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.weight_kg ELSE 0 END), 0)
    AS hand_on_balance_kg
FROM movements m
JOIN lots l ON m.lot_id = l.id
JOIN products p ON l.product_id = p.id
JOIN locations loc ON m.location_id = loc.id
GROUP BY p.id, l.id, loc.id
HAVING hand_on_balance_mc > 0;

-- ============================================================
-- 6. DASHBOARD SUMMARY VIEW
-- ============================================================
CREATE OR REPLACE VIEW dashboard_summary AS
SELECT
    COALESCE(SUM(hand_on_balance_mc), 0) AS total_mc,
    COALESCE(SUM(hand_on_balance_kg), 0) AS total_kg,
    COUNT(DISTINCT location_id) AS total_stacks
FROM inventory_view;
