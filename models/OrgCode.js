class OrgCode {
  constructor(db) {
    this.db = db;
  }

  async query(sql, params = []) {
    const [results] = await this.db.execute(sql, params);
    return results;
  }

  async queryOne(sql, params = []) {
    const [results] = await this.db.execute(sql, params);
    return results[0] || null;
  }

  async initDatabase() {
    const createOrgCodesTable = `
      CREATE TABLE IF NOT EXISTS org_codes (
        id VARCHAR(50) PRIMARY KEY,
        org_code VARCHAR(100) UNIQUE NOT NULL,
        organization VARCHAR(255) NOT NULL,
        address1 VARCHAR(255) DEFAULT NULL,
        address2 VARCHAR(255) DEFAULT NULL,
        city VARCHAR(100) DEFAULT NULL,
        state VARCHAR(50) DEFAULT NULL,
        postalCode VARCHAR(20) DEFAULT NULL,
        initial_program_prompt TEXT DEFAULT NULL,
        next_program_prompt TEXT DEFAULT NULL,
        therapy_response_prompt TEXT DEFAULT NULL,
        expires_at DATETIME DEFAULT NULL,
        duration_start DATETIME DEFAULT NULL,
        duration_end DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_org_code (org_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createOrgCodesTable);
      console.log('OrgCodes table initialized successfully.');

      // Migration: Add new address columns if they don't exist
      const addressColumns = [
        { name: 'address1', type: 'VARCHAR(255) DEFAULT NULL' },
        { name: 'address2', type: 'VARCHAR(255) DEFAULT NULL' },
        { name: 'city', type: 'VARCHAR(100) DEFAULT NULL' },
        { name: 'state', type: 'VARCHAR(50) DEFAULT NULL' },
        { name: 'postalCode', type: 'VARCHAR(20) DEFAULT NULL' }
      ];

      for (const column of addressColumns) {
        try {
          const columnExists = await this.queryOne(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'org_codes'
              AND COLUMN_NAME = '${column.name}'
          `);

          if (!columnExists) {
            await this.query(`ALTER TABLE org_codes ADD COLUMN ${column.name} ${column.type}`);
            console.log(`Added ${column.name} column to org_codes table`);
          }
        } catch (colErr) {
          console.warn(`Warning adding ${column.name} column:`, colErr.message);
        }
      }

      // Migration: Add duration columns if they don't exist
      const durationColumns = [
        { name: 'duration_start', type: 'DATETIME DEFAULT NULL' },
        { name: 'duration_end', type: 'DATETIME DEFAULT NULL' }
      ];

      for (const column of durationColumns) {
        try {
          const columnExists = await this.queryOne(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'org_codes'
              AND COLUMN_NAME = '${column.name}'
          `);

          if (!columnExists) {
            await this.query(`ALTER TABLE org_codes ADD COLUMN ${column.name} ${column.type}`);
            console.log(`Added ${column.name} column to org_codes table`);
          }
        } catch (colErr) {
          console.warn(`Warning adding ${column.name} column:`, colErr.message);
        }
      }

      // Migration: Drop user_id column if it exists (from old schema)
      try {
        // Check if column exists
        const columnExists = await this.queryOne(`
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'org_codes'
            AND COLUMN_NAME = 'user_id'
        `);

        if (columnExists) {
          // Drop foreign key constraint first
          try {
            await this.query('ALTER TABLE org_codes DROP FOREIGN KEY fk_org_codes_user');
            console.log('Dropped foreign key constraint fk_org_codes_user');
          } catch (fkErr) {
            console.warn('Could not drop foreign key (might not exist):', fkErr.message);
          }
          // Then drop the column
          await this.query('ALTER TABLE org_codes DROP COLUMN user_id');
          console.log('Migrated org_codes table: dropped user_id column and foreign key');
        } else {
          console.log('Org_codes table does not have user_id column (already migrated)');
        }
      } catch (migrationErr) {
        console.warn('Migration warning for org_codes table:', migrationErr.message);
      }
    } catch (err) {
      console.error('Error creating org_codes table:', err.message);
      throw err;
    }
  }

  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  async createOrgCode(data) {
    const {
      org_code,
      organization,
      address1 = null,
      address2 = null,
      city = null,
      state = null,
      postalCode = null,
      initial_program_prompt = null,
      next_program_prompt = null,
      therapy_response_prompt = null,
      expires_at = null,
      duration_start = null,
      duration_end = null
    } = data;

    if (!org_code || !organization) {
      throw new Error('org_code and organization are required');
    }

    const id = this.generateUniqueId();

    try {
      await this.query(
        `INSERT INTO org_codes
          (id, org_code, organization, address1, address2, city, state, postalCode, initial_program_prompt, next_program_prompt, therapy_response_prompt, expires_at, duration_start, duration_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [id, org_code, organization, address1, address2, city, state, postalCode, initial_program_prompt, next_program_prompt, therapy_response_prompt, expires_at, duration_start, duration_end]
      );

      return this.getOrgCodeById(id);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        if (err.message.includes('org_code')) {
          throw new Error('org_code already exists');
        }
      }
      throw new Error('Failed to create org code');
    }
  }

  async getOrgCodeById(id) {
    const row = await this.queryOne('SELECT id, org_code, organization, address1, address2, city, state, postalCode, expires_at, duration_start, duration_end, created_at, updated_at FROM org_codes WHERE id = ?', [id]);
    if (!row) throw new Error('OrgCode not found');
    return row;
  }

  async getOrgCodeByCode(orgCode) {
    const row = await this.queryOne('SELECT id, org_code, organization, address1, address2, city, state, postalCode, expires_at, duration_start, duration_end, created_at, updated_at FROM org_codes WHERE org_code = ?', [orgCode]);
    if (!row) throw new Error('OrgCode not found');
    return row;
  }

  // Returns active (non-expired) org code by ID
  async getActiveOrgCodeById(orgCodeId) {
    const orgCode = await this.getOrgCodeById(orgCodeId);
    if (!orgCode) return null;

    // Check if expired
    if (orgCode.expires_at && new Date(orgCode.expires_at) <= new Date()) {
      return null;
    }

    return orgCode;
  }

  async updateOrgCode(id, updateData) {
    const allowed = ['org_code', 'organization', 'address1', 'address2', 'city', 'state', 'postalCode', 'initial_program_prompt', 'next_program_prompt', 'therapy_response_prompt', 'expires_at', 'duration_start', 'duration_end'];
    const fields = [];
    const values = [];

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(updateData, key)) {
        fields.push(`${key} = ?`);
        values.push(updateData[key]);
      }
    }

    if (fields.length === 0) {
      throw new Error('At least one field must be provided for update');
    }

    values.push(id);

    try {
      const result = await this.query(
        `UPDATE org_codes SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
      if (result.affectedRows === 0) throw new Error('OrgCode not found');
      return this.getOrgCodeById(id);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        if (err.message.includes('org_code')) throw new Error('org_code already exists');
        if (err.message.includes('user_id')) throw new Error('User already has an org code assigned');
      }
      if (err.message === 'OrgCode not found') throw err;
      throw new Error('Failed to update org code');
    }
  }

  // Assign an org code to a user (1:1 — clears any prior assignment on this code)
  async assignToUser(orgCodeId, userId) {
    return this.updateOrgCode(orgCodeId, { user_id: userId });
  }

  async deleteOrgCode(id) {
    const result = await this.query('DELETE FROM org_codes WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw new Error('OrgCode not found');
    return { message: 'OrgCode deleted successfully' };
  }

  async getAllOrgCodes() {
    return this.query('SELECT id, org_code, organization, address1, address2, city, state, postalCode, expires_at, duration_start, duration_end, created_at, updated_at FROM org_codes ORDER BY created_at DESC');
  }
}

module.exports = OrgCode;
