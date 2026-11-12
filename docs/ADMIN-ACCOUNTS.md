# Additional admin accounts

Every active ADMIN account uses the same dashboard, bookings, check-ins and scanner. Each person has a separate email/password and session. There is no public signup, Add Admin screen or account-creation API.

From an authorised interactive terminal in the application root, run:

```sh
npm run admin:create
```

Enter the admin's name, email, password and confirmation when prompted. Password input is hidden; use a unique password of at least 12 characters. Do not put passwords into commands, chat, screenshots or GitHub. The tool stores the existing application's salted password hash, rejects duplicate emails (including other staff roles), and records an account-creation audit entry. It does not reset/migrate/seed the database or modify existing accounts.

For Hostinger, first deploy this command's code, then connect through your authorised SSH/terminal access and change to the existing deployed project root containing package.json. The shell must load the same application configuration and production MySQL connection as the running app. hPanel environment variables may not automatically be available in an SSH shell. If they are unavailable, configure them privately using your existing secure deployment procedure; never substitute local/demo database settings. Do not commit an .env file. If your hosting account does not provide terminal access, an authorised hosting operator must run this command against the production database.

After the command succeeds, the new admin signs in at https://tickets.santassocial.com/login with their own credentials. Test in a separate browser/private window; all admins see the same data. No application restart is needed after creating an account in the running application's database. Leave the bootstrap ADMIN_EMAIL/ADMIN_PASSWORD environment variables unchanged: changing them is not the way to add accounts.

To revoke access, an authorised database operator can set that user's active column to 0 (retain the row and approval history). Existing sessions check active status on each API request. Keep at least one active admin. Never delete users linked to payment approvals or check-ins.
