/** Provision only a fresh, disposable restricted role; never modifies existing roles. */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
export async function withOpenAiDisposableRuntime<T>(run: (runtimeUrl: string) => Promise<T>): Promise<T> {
    const owner = process.env.AGENTMARGIN_STANDALONE_DATABASE_URL;
    if (!owner)
        throw new Error('Disposable database URL required');
    const url = new URL(owner);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash || url.hostname !== '127.0.0.1' || url.pathname !== '/agentmargin_ci' || url.username !== 'agentmargin_ci')
        throw new Error('Disposable local database only');
    const role = 'openai_qa_' + randomBytes(8).toString('hex'), password = randomBytes(32).toString('base64url');
    const pool = new pg.Pool({ connectionString: owner, max: 1 });
    let created = false;
    try {
        const formatted = await pool.query(`SELECT format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',$1::text,$2::text) AS sql`, [role, password]);
        await pool.query(formatted.rows[0].sql);
        created = true;
        const grants = readFileSync(new URL('../../db/runtime_privileges.psql', import.meta.url), 'utf8').replaceAll(':"runtime_role"', '"' + role + '"').replaceAll(":'runtime_role'", "'" + role + "'").split('\n').filter(line => !line.startsWith('--')).join('\n');
        await pool.query(grants);
        url.username = role;
        url.password = password;
        return await run(url.toString());
    }
    finally {
        try {
            if (created) {
                await pool.query('ROLLBACK');
                await pool.query((await pool.query("SELECT format('DROP OWNED BY %I', $1::text) AS sql", [role])).rows[0].sql);
                await pool.query((await pool.query("SELECT format('DROP ROLE %I', $1::text) AS sql", [role])).rows[0].sql);
            }
        }
        finally {
            await pool.end();
        }
    }
}
