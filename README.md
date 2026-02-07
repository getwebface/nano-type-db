## 🔧 Database & Schema Management

We have transitioned to a **Type-Safe Schema** using Drizzle ORM.

**Source of Truth:** `src/db/schema.ts`

### How to Modify the Database
1.  **Edit Schema**: Modify `src/db/schema.ts` (add tables, columns, etc.).
2.  **Generate Migration**:
    ```bash
    npx drizzle-kit generate
    ```
    This creates a new SQL file in `migrations/`.
3.  **Apply Migration**:
    ```bash
    # Local Development
    npm run migrate:up -- --local
    
    # Production
    npm run migrate:up -- --remote
    ```

⚠️ **Do not manually edit SQL files.** Always use Drizzle Kit.
