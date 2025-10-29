<?php
/**
 * Post meta hooks for Fair Registration
 *
 * @package FairRegistration
 */

namespace FairRegistration\Hooks;

defined( 'WPINC' ) || die;

/**
 * Handles post meta updates for registration forms
 */
class PostMetaHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'save_post', array( $this, 'update_registration_form_meta' ), 10, 3 );
	}

	/**
	 * Update post meta when a post is saved
	 *
	 * Sets _has_registration_form meta to '1' if post contains fair-registration/form block
	 *
	 * @param int      $post_id Post ID.
	 * @param \WP_Post $post    Post object.
	 * @param bool     $update  Whether this is an existing post being updated.
	 * @return void
	 */
	public function update_registration_form_meta( $post_id, $post, $update ) {
		// Avoid auto-saves and revisions.
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		// Check if user has permission to edit.
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		// Only process posts and pages.
		if ( ! in_array( $post->post_type, array( 'post', 'page' ), true ) ) {
			return;
		}

		// Check if post contains registration form block.
		if ( has_block( 'fair-registration/form', $post ) ) {
			// Set meta to indicate this post has a registration form.
			update_post_meta( $post_id, '_has_registration_form', '1' );
		} else {
			// Remove meta if block was removed.
			delete_post_meta( $post_id, '_has_registration_form' );
		}
	}
}
