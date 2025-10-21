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
}
