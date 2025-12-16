<?php
/**
 * Block registration hooks for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Hooks;

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
		register_block_type( __DIR__ . '/../../build/blocks/membership-switch' );
		register_block_type( __DIR__ . '/../../build/blocks/member-content' );
		register_block_type( __DIR__ . '/../../build/blocks/non-member-content' );
		register_block_type( __DIR__ . '/../../build/blocks/my-fees' );

		// Set script translations for blocks
		wp_set_script_translations(
			'fair-membership-membership-switch-editor-script',
			'fair-membership',
			dirname( __DIR__, 2 ) . '/build/languages'
		);
		wp_set_script_translations(
			'fair-membership-member-content-editor-script',
			'fair-membership',
			dirname( __DIR__, 2 ) . '/build/languages'
		);
		wp_set_script_translations(
			'fair-membership-non-member-content-editor-script',
			'fair-membership',
			dirname( __DIR__, 2 ) . '/build/languages'
		);
		wp_set_script_translations(
			'fair-membership-my-fees-editor-script',
			'fair-membership',
			dirname( __DIR__, 2 ) . '/build/languages'
		);
	}
}
