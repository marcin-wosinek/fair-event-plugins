<?php
/**
 * Backfill tool for Fair Registration
 *
 * @package FairRegistration
 */

namespace FairRegistration\Admin\Tools;

defined( 'WPINC' ) || die;

/**
 * Tool to backfill _has_registration_form meta for existing posts
 */
class BackfillTool {

	/**
	 * Backfill registration form meta for all existing posts
	 *
	 * Scans all published posts/pages and sets _has_registration_form meta
	 * if they contain the fair-registration/form block
	 *
	 * @return array Results with 'found', 'updated', and 'removed' counts
	 */
	public static function backfill_registration_meta() {
		$results = array(
			'found'   => 0,
			'updated' => 0,
			'removed' => 0,
		);

		// Query all published posts and pages.
		$args = array(
			'post_type'      => array( 'post', 'page' ),
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'fields'         => 'ids',
		);

		$post_ids = get_posts( $args );

		foreach ( $post_ids as $post_id ) {
			$post = get_post( $post_id );

			if ( has_block( 'fair-registration/form', $post ) ) {
				++$results['found'];

				// Check if meta already set correctly.
				$current_meta = get_post_meta( $post_id, '_has_registration_form', true );

				if ( '1' !== $current_meta ) {
					update_post_meta( $post_id, '_has_registration_form', '1' );
					++$results['updated'];
				}
			} else {
				// If post doesn't have the block but has the meta, remove it.
				$current_meta = get_post_meta( $post_id, '_has_registration_form', true );

				if ( '1' === $current_meta ) {
					delete_post_meta( $post_id, '_has_registration_form' );
					++$results['removed'];
				}
			}
		}

		return $results;
	}

	/**
	 * Get all posts with registration forms
	 *
	 * @return array Array of post objects
	 */
	public static function get_posts_with_forms() {
		$args = array(
			'post_type'      => array( 'post', 'page' ),
			'post_status'    => 'publish',
			'posts_per_page' => -1,
		);

		$posts            = get_posts( $args );
		$posts_with_forms = array();

		foreach ( $posts as $post ) {
			if ( has_block( 'fair-registration/form', $post ) ) {
				$posts_with_forms[] = $post;
			}
		}

		return $posts_with_forms;
	}
}
