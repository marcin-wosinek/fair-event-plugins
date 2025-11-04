<?php
/**
 * Block registration hooks for Fair RSVP
 *
 * @package FairRsvp
 */

namespace FairRsvp\Hooks;

defined( 'WPINC' ) || die;

/**
 * Handles WordPress block registration and hooks
 */
class BlockHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'init', array( $this, 'register_blocks' ) );
		add_action( 'save_post', array( $this, 'update_rsvp_block_meta' ), 10, 3 );
	}

	/**
	 * Register all block types
	 *
	 * @return void
	 */
	public function register_blocks() {
		register_block_type( __DIR__ . '/../../build/blocks/rsvp-button' );
		register_block_type( __DIR__ . '/../../build/blocks/participants-list' );

		// Set script translations for blocks (editor scripts)
		wp_set_script_translations(
			'fair-rsvp-rsvp-button-editor-script',
			'fair-rsvp',
			dirname( __DIR__, 2 ) . '/build/languages'
		);
		wp_set_script_translations(
			'fair-rsvp-participants-list-editor-script',
			'fair-rsvp',
			dirname( __DIR__, 2 ) . '/build/languages'
		);

		// Set script translations for blocks (frontend scripts)
		wp_set_script_translations(
			'fair-rsvp-rsvp-button-view-script',
			'fair-rsvp',
			dirname( __DIR__, 2 ) . '/build/languages'
		);
	}

	/**
	 * Update post meta to track if post has RSVP block
	 *
	 * Works on any post type (events, posts, pages, etc.).
	 *
	 * @param int      $post_id Post ID.
	 * @param \WP_Post $post    Post object.
	 * @param bool     $update  Whether this is an existing post being updated.
	 * @return void
	 */
	public function update_rsvp_block_meta( $post_id, $post, $update ) {
		// Skip autosaves and revisions.
		if ( wp_is_post_autosave( $post_id ) || wp_is_post_revision( $post_id ) ) {
			return;
		}

		// Check if post has RSVP block.
		$has_rsvp_block = has_block( 'fair-rsvp/rsvp-button', $post );

		// Update post meta.
		update_post_meta( $post_id, '_has_rsvp_block', $has_rsvp_block ? '1' : '0' );
	}
}
