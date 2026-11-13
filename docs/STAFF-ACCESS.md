# Staff access

Admin and Staff use the existing `/login` form and the same fixed 24-hour staff session. The database role `staff` grants the existing Admin capabilities except Overview. Staff land on `/admin/bookings`; `/api/admin/dashboard` returns 403, and direct Overview navigation redirects to Bookings. Cashier and scanner-only restrictions remain unchanged.

## Secure provisioning

From an interactive terminal in the deployed application directory with the existing production environment/database configuration loaded, run:

```sh
npm run staff:provision
```

Enter the staff name and `sivaraj@therushrepublic.com`. For a new account, enter and confirm a unique password of 12 to 200 characters at the hidden prompts. For an existing account, leave both password prompts blank: its password, name, ID, creation timestamp and active state are preserved; only the role and normalized email are updated. Inactive accounts and ambiguous case-insensitive duplicates require manual review first. Do not supply passwords as command arguments, commit them, or paste them into chat.

The command uses the existing salted scrypt hash and writes an audit entry in a transaction. It never creates a public provisioning endpoint. Running it again does not create a duplicate or reset the password. This explicit command can change an existing account to Staff, so verify the email before running it; it does not change any other Admin account.

No schema migration or booking/payment changes are required: `users.role` already supports the role. Production provisioning is pending until the owner runs this command with the private initial password. Do not claim the account is active based on a code deployment alone.

## Deployment

Use the existing GitHub main-branch Hostinger deployment. Keep all production environment variables unchanged. After deployment/provisioning, verify Admin Overview, Staff Bookings/Check-ins/Scanner access, Staff Overview API 403, cash approval and shared-session logout. No database reset or seed command is needed.
