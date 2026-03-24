Run a security-focused test suite against the DrawPro API.

Test the following categories against http://localhost:3001:

**Authentication:**
- Login with invalid credentials → expect 401
- Access protected route without token → expect 401
- Access protected route with expired/malformed token → expect 401
- Refresh with invalid/revoked refresh token → expect error
- Verify tokens have appropriate TTLs

**Input Validation:**
- Send malformed JSON to POST endpoints → expect 400
- Send missing required fields → expect validation error
- Send excessively long strings → check for proper handling
- Test SQL injection patterns in string fields → should be safe (Prisma parameterized)
- Test XSS payloads in name/email fields → should be sanitized or stored safely

**Authorization:**
- Access another user's workspace → expect 403/404
- Access sheets in a workspace user is not a member of → expect error
- Try to modify resources owned by another user

**Rate Limiting:**
- Send rapid requests to /auth/login to verify rate limiting is active

**Headers:**
- Check for security headers (helmet): X-Content-Type-Options, X-Frame-Options, etc.
- Check CORS configuration

For each test, show the curl command, expected result, actual result, and pass/fail. Summarize with a security score.
