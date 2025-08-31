<?php
/**
 * Block registration hooks for Fair Schedule Blocks
 *
 * @package FairScheduleBlocks
 */

namespace FairScheduleBlocks\Hooks;

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
		register_block_type( __DIR__ . '/../../build/blocks/schedule-accordion' );
	}
}
