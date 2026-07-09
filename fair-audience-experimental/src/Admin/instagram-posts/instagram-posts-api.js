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
 * @param {number} [data.attachment_id] Temporary attachment to delete after a successful publish
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
 * Resolve a WordPress attachment's public media-library URL
 *
 * @param {number} attachmentId WordPress attachment ID
 * @return {Promise<Object>} Promise resolving to { url: string }
 */
export function getAttachmentUrl(attachmentId) {
	return apiFetch({
		path: '/fair-audience/v1/instagram/upload-image',
		method: 'POST',
		data: { attachment_id: attachmentId },
	});
}

/**
 * Store a base64-encoded image blob as a media-library attachment
 *
 * @param {string} base64Data Base64-encoded PNG image data (with or without data URI prefix)
 * @return {Promise<Object>} Promise resolving to { url: string, attachment_id: number }
 */
export function uploadImageBlob(base64Data) {
	return apiFetch({
		path: '/fair-audience/v1/instagram/upload-blob',
		method: 'POST',
		data: { image_data: base64Data },
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
