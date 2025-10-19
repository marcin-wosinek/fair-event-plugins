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
	}
}
