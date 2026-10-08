const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'printify',
    password: 'Maxi09*theo11'
})
module.exports = pool;