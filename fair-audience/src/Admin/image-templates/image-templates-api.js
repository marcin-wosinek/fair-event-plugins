/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load all image templates from the REST API
 *
 * @return {Promise<Array>} Promise resolving to array of templates
 */
export function loadTemplates() {
	return apiFetch({ path: '/fair-audience/v1/image-templates' });
}

/**
 * Register an attachment as an image template
 *
 * @param {number} attachmentId WordPress attachment ID
 * @return {Promise<Object>} Promise resolving to created template
 */
export function registerTemplate(attachmentId) {
	return apiFetch({
		path: '/fair-audience/v1/image-templates',
		method: 'POST',
		data: { attachment_id: attachmentId },
	});
}

/**
 * Remove template meta from attachment
 *
 * @param {number} id Template (attachment) ID
 * @return {Promise<Object>} Promise resolving to deletion result
 */
export function deleteTemplate(id) {
	return apiFetch({
		path: `/fair-audience/v1/image-templates/${id}`,
		method: 'DELETE',
	});
}

/**
 * Render a template with provided variables and images
 *
 * @param {number} id        Template (attachment) ID
 * @param {Object} variables Object mapping variable names to text values
 * @param {Object} images    Object mapping image placeholder names to attachment IDs
 * @return {Promise<Object>} Promise resolving to { svg: "..." }
 */
export function renderTemplate(id, variables, images) {
	return apiFetch({
		path: `/fair-audience/v1/image-templates/${id}/render`,
		method: 'POST',
		data: { variables, images },
	});
}
