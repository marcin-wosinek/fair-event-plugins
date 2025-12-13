/**
 * WordPress authentication helper for Playwright API tests
 *
 * Provides utilities for authenticating with WordPress REST API
 * using browser-based login and nonce extraction.
 */

/**
 * Get WordPress authentication credentials and headers
 *
 * @param {import('@playwright/test').APIRequestContext} request - Playwright request context
 * @param {string} baseURL - WordPress base URL (default: http://localhost:8080)
 * @returns {Promise<{cookies: string, nonce: string, headers: Object}>} Authentication data
 */
export async function getWordPressAuth(
	request,
	baseURL = 'http://localhost:8080'
) {
	const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
	const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

	// Step 1: Login to WordPress
	const loginResponse = await request.post(`${baseURL}/wp-login.php`, {
		form: {
			log: WP_ADMIN_USER,
			pwd: WP_ADMIN_PASS,
			'wp-submit': 'Log In',
			redirect_to: `${baseURL}/wp-admin/`,
			testcookie: '1',
		},
	});

	// Extract cookies from login response
	// Set-Cookie headers come as an array or string, we need to parse them
	// to extract just the cookie name=value pairs (not the attributes)
	const setCookieHeader = loginResponse.headers()['set-cookie'];
	let cookieArray = [];

	if (setCookieHeader) {
		if (Array.isArray(setCookieHeader)) {
			cookieArray = setCookieHeader;
		} else {
			cookieArray = [setCookieHeader];
		}
	}

	// Check if we got WordPress authentication cookies
	const hasWordPressCookie = cookieArray.some((cookie) =>
		cookie.includes('wordpress_logged_in')
	);

	if (!hasWordPressCookie) {
		const responseText = await loginResponse.text();
		throw new Error(
			`WordPress login failed. No authentication cookies received. ` +
				`Status: ${loginResponse.status()}. ` +
				`Credentials: ${WP_ADMIN_USER}/${WP_ADMIN_PASS}. ` +
				`Response (first 200 chars): ${responseText.substring(0, 200)}`
		);
	}

	// Parse each Set-Cookie header to extract just the name=value part
	const cookies = cookieArray
		.map((cookie) => {
			// Split by semicolon and take only the first part (name=value)
			return cookie.split(';')[0].trim();
		})
		.join('; ');

	// Step 2: Get nonce from REST API root
	// Try pretty permalinks first, then fall back to plain permalinks
	let rootResponse = await request.get(`${baseURL}/wp-json/`, {
		headers: {
			Cookie: cookies,
		},
	});

	// If pretty permalinks don't work (404), try plain permalinks
	if (rootResponse.status() === 404) {
		rootResponse = await request.get(`${baseURL}/?rest_route=/`, {
			headers: {
				Cookie: cookies,
			},
		});
	}

	// Check if we got JSON response
	const contentType = rootResponse.headers()['content-type'];
	if (!contentType || !contentType.includes('application/json')) {
		const responseText = await rootResponse.text();
		throw new Error(
			`Expected JSON from WordPress REST API, got ${contentType}. ` +
				`Response (first 200 chars): ${responseText.substring(0, 200)}`
		);
	}

	const rootData = await rootResponse.json();
	const nonce = rootData.nonce || '';

	// Return authentication data
	return {
		cookies,
		nonce,
		headers: {
			Cookie: cookies,
			'X-WP-Nonce': nonce,
		},
	};
}
