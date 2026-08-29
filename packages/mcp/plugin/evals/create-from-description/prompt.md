Draw a diagram of this login flow in my DrawPro account, in whichever workspace
you find first:

The browser posts credentials to the API. The API looks the user up in Postgres.
If the password matches it mints a JWT and stores a refresh token in Redis;
otherwise it returns a 401.
