Run an end-to-end test flow against the running DrawPro stack using curl.

Execute the following sequence and report results at each step:

1. **Health check** — verify API is reachable at http://localhost:3001
2. **Register** — `POST /auth/register` with a unique test email
3. **Login** — `POST /auth/login` with the registered credentials, capture access token and refresh token cookie
4. **Get profile** — `GET /auth/me` with the access token
5. **Create workspace** — `POST /workspaces` with a test name
6. **List workspaces** — `GET /workspaces` and verify the new workspace appears
7. **Create sheet** — `POST /workspaces/:wid/sheets` under the new workspace
8. **Get sheet** — `GET /workspaces/:wid/sheets/:sid` and verify content
9. **Update sheet** — `PUT /workspaces/:wid/sheets/:sid` with test elements data
10. **Delete sheet** — `DELETE /workspaces/:wid/sheets/:sid`
11. **Refresh token** — `POST /auth/refresh` using the refresh token cookie
12. **Logout** — `POST /auth/logout`
13. **Verify logout** — `GET /auth/me` should return 401

For each step, show: request → response status → pass/fail.

At the end, provide a summary with total pass/fail count. If any step fails, stop and diagnose.
