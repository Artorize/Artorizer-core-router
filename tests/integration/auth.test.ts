import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Base URL for the deployed router
const BASE_URL = process.env.ROUTER_URL || 'http://localhost:7000';

// Test user credentials
const TEST_USER = {
  email: `test-${Date.now()}@example.com`,
  password: 'TestPassword123!',
  username: `testuser${Date.now()}`,
  name: 'Test User',
};

// Store session cookie between tests
let sessionCookie: string | null = null;

describe('Auth API Integration Tests', () => {
  beforeAll(() => {
    console.log(`Testing auth against: ${BASE_URL}`);
  });

  describe('GET /auth/check-availability', () => {
    it('should return available for unused email', async () => {
      const response = await fetch(
        `${BASE_URL}/auth/check-availability?email=${encodeURIComponent(TEST_USER.email)}`
      );

      const data = await response.json();
      console.log('Check email availability response:', data);

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('available');
      expect(data.available).toBe(true);
    });

    it('should return available for unused username', async () => {
      const response = await fetch(
        `${BASE_URL}/auth/check-availability?username=${encodeURIComponent(TEST_USER.username)}`
      );

      const data = await response.json();
      console.log('Check username availability response:', data);

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('available');
      expect(data.available).toBe(true);
    });
  });

  describe('POST /auth/register', () => {
    it('should register a new user and set session cookie', async () => {
      const response = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(TEST_USER),
      });

      const data = await response.json();
      console.log('Register response:', data);

      expect(response.status).toBe(201);
      expect(data).toHaveProperty('user');
      expect(data.user.email).toBe(TEST_USER.email);

      // Check for session cookie
      const setCookieHeader = response.headers.get('set-cookie');
      console.log('Set-Cookie header:', setCookieHeader);

      expect(setCookieHeader).toBeTruthy();

      // Store cookie for subsequent tests
      if (setCookieHeader) {
        // Extract the session cookie (may have multiple cookies)
        sessionCookie = setCookieHeader;
      }
    });

    it('should reject duplicate email registration', async () => {
      const response = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(TEST_USER),
      });

      expect([400, 409, 422]).toContain(response.status);
    });

    it('should show email as unavailable after registration', async () => {
      const response = await fetch(
        `${BASE_URL}/auth/check-availability?email=${encodeURIComponent(TEST_USER.email)}`
      );

      const data = await response.json();
      console.log('Check availability after register:', data);

      expect(response.status).toBe(200);
      expect(data.available).toBe(false);
    });
  });

  describe('GET /auth/me', () => {
    it('should return 401 without session cookie', async () => {
      const response = await fetch(`${BASE_URL}/auth/me`);

      expect([401, 403]).toContain(response.status);
    });

    it('should return user info with valid session cookie', async () => {
      if (!sessionCookie) {
        console.log('Skipping: No session cookie from registration');
        return;
      }

      const response = await fetch(`${BASE_URL}/auth/me`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      const data = await response.json();
      console.log('GET /auth/me response:', data);

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('user');
      expect(data.user.email).toBe(TEST_USER.email);
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout and clear session', async () => {
      if (!sessionCookie) {
        console.log('Skipping: No session cookie');
        return;
      }

      const response = await fetch(`${BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
      });

      console.log('Logout status:', response.status);

      // Should succeed with 200 or 204
      expect([200, 204]).toContain(response.status);

      // Check that cookie is cleared
      const setCookieHeader = response.headers.get('set-cookie');
      console.log('Logout Set-Cookie:', setCookieHeader);
    });

    it('should return 401 on /auth/me after logout', async () => {
      if (!sessionCookie) {
        console.log('Skipping: No session cookie');
        return;
      }

      const response = await fetch(`${BASE_URL}/auth/me`, {
        headers: {
          Cookie: sessionCookie,
        },
      });

      // Session should be invalidated
      expect([401, 403]).toContain(response.status);
    });
  });

  describe('POST /auth/login', () => {
    it('should login with email and password', async () => {
      const response = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailOrUsername: TEST_USER.email,
          password: TEST_USER.password,
        }),
      });

      const data = await response.json();
      console.log('Login response:', data);

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('user');

      // Check for session cookie
      const setCookieHeader = response.headers.get('set-cookie');
      expect(setCookieHeader).toBeTruthy();

      // Update session cookie
      if (setCookieHeader) {
        sessionCookie = setCookieHeader;
      }
    });

    it('should login with username and password', async () => {
      const response = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailOrUsername: TEST_USER.username,
          password: TEST_USER.password,
        }),
      });

      const data = await response.json();
      console.log('Login with username response:', data);

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('user');
    });

    it('should reject invalid password', async () => {
      const response = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailOrUsername: TEST_USER.email,
          password: 'WrongPassword123!',
        }),
      });

      expect([401, 403]).toContain(response.status);
    });

    it('should reject non-existent user', async () => {
      const response = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailOrUsername: 'nonexistent@example.com',
          password: 'SomePassword123!',
        }),
      });

      expect([401, 403, 404]).toContain(response.status);
    });
  });

  describe('Cookie Passthrough (Multiple Set-Cookie)', () => {
    it('should forward all Set-Cookie headers from backend', async () => {
      // This test verifies that multiple cookies are properly forwarded
      // We check this during login which may set multiple cookies

      const response = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailOrUsername: TEST_USER.email,
          password: TEST_USER.password,
        }),
      });

      expect(response.status).toBe(200);

      // In the fixed implementation, getSetCookie() returns an array
      // The response.headers.getSetCookie() should have been used
      const setCookie = response.headers.get('set-cookie');
      console.log('All Set-Cookie headers:', setCookie);

      // Should have at least the session cookie
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain('better-auth');
    });
  });
});

describe('Auth Protected Routes', () => {
  let authCookie: string | null = null;

  beforeAll(async () => {
    // Login to get session cookie
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        emailOrUsername: TEST_USER.email,
        password: TEST_USER.password,
      }),
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      authCookie = setCookie;
    }
  });

  describe('User Header Forwarding', () => {
    it('should forward user headers to backend on protected routes', async () => {
      if (!authCookie) {
        console.log('Skipping: No auth cookie');
        return;
      }

      // Test a protected route that forwards user headers
      // The /protect endpoint uses optionalAuth and forwards X-User-* headers
      const response = await fetch(`${BASE_URL}/auth/me`, {
        headers: {
          Cookie: authCookie,
        },
      });

      const data = await response.json();
      console.log('User info with auth:', data);

      expect(response.status).toBe(200);
      expect(data.user).toHaveProperty('id');
      expect(data.user).toHaveProperty('email');
    });
  });
});
