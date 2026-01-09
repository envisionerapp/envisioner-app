require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');

async function checkDb() {
  const sql = neon(process.env.DATABASE_URL);

  // List all tables
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;

  console.log('\n=== TABLES ===');
  console.log(tables.map(t => t.table_name).join('\n'));

  // For each table, show columns
  for (const t of tables) {
    const columns = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = ${t.table_name}
      ORDER BY ordinal_position
    `;
    console.log(`\n=== ${t.table_name.toUpperCase()} ===`);
    console.log(columns.map(c => `  ${c.column_name}: ${c.data_type}`).join('\n'));
  }
}

checkDb().catch(console.error);
