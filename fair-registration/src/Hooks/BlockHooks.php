<?php
/**
 * Block registration and hooks for Fair Registration
 *
 * @package FairRegistration
 */

namespace FairRegistration\Hooks;

defined( 'WPINC' ) || die;

/**
 * Handles block registration and related WordPress hooks
 */
class BlockHooks {
	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'init', array( $this, 'register_blocks' ) );
	}

	/**
	 * Register all plugin blocks
	 *
	 * @return void
	 */
	public function register_blocks() {
		// Register main form block
		register_block_type( __DIR__ . '/../../build/blocks/registration-form' );

		// Register field blocks
		register_block_type( __DIR__ . '/../../build/blocks/email-field' );
		register_block_type( __DIR__ . '/../../build/blocks/short-text-field' );
		register_block_type( __DIR__ . '/../../build/blocks/long-text-field' );
		register_block_type( __DIR__ . '/../../build/blocks/phone-number-field' );
		register_block_type( __DIR__ . '/../../build/blocks/checkbox-field' );
		register_block_type( __DIR__ . '/../../build/blocks/select-field' );
	}
}
