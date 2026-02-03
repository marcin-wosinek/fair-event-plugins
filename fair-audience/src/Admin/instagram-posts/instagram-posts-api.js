/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load all Instagram posts from the REST API
 *
 * @param {string|null} status Optional status filter
 * @return {Promise<Array>} Promise resolving to array of posts
 */
export function loadInstagramPosts(status = null) {
	let path = '/fair-audience/v1/instagram/posts';
	if (status) {
		path += `?status=${encodeURIComponent(status)}`;
	}
	return apiFetch({ path });
}

/**
 * Create and publish an Instagram post
 *
 * @param {Object} data Post data
 * @param {string} data.image_url Publicly accessible image URL
 * @param {string} data.caption Post caption
 * @return {Promise<Object>} Promise resolving to created post
 */
export function createInstagramPost(data) {
	return apiFetch({
		path: '/fair-audience/v1/instagram/posts',
		method: 'POST',
		data,
	});
}

/**
 * Delete an Instagram post record
 *
 * @param {number} id Post ID
 * @return {Promise<Object>} Promise resolving to deletion result
 */
export function deleteInstagramPost(id) {
	return apiFetch({
		path: `/fair-audience/v1/instagram/posts/${id}`,
		method: 'DELETE',
	});
}
