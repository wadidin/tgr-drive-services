import bcrypt from 'bcryptjs';
import { pool, query } from '../config/db.js';
import { env } from '../config/env.js';

async function seed() {
  console.log('Seeding initial TGR Drive users & default folder...');

  const adminHash = await bcrypt.hash('AdminTgr123!', 10);
  const uploaderHash = await bcrypt.hash('BudiTgr123!', 10);

  await query(
    `INSERT INTO users (username, password_hash, display_name, role, is_active)
     VALUES ('admin_tgr', $1, 'Super Admin TGR', 'admin', TRUE)
     ON CONFLICT (username) DO NOTHING`,
    [adminHash]
  );

  await query(
    `INSERT INTO users (username, password_hash, display_name, role, is_active)
     VALUES ('budi_tim', $1, 'Budi Santoso', 'user', TRUE)
     ON CONFLICT (username) DO NOTHING`,
    [uploaderHash]
  );

  await query(
    `INSERT INTO drive_integration (id, google_email, encrypted_refresh_token, target_folder_id)
     VALUES (1, 'fototgr@gmail.com', '', $1)
     ON CONFLICT (id) DO NOTHING`,
    [env.GOOGLE_DEFAULT_FOLDER_ID]
  );

  console.log('Seed completed! Default accounts:');
  console.log('  Admin    -> admin_tgr / AdminTgr123!');
  console.log('  Uploader -> budi_tim  / BudiTgr123!');
  console.log(`  Folder   -> ${env.GOOGLE_DEFAULT_FOLDER_ID}`);
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
