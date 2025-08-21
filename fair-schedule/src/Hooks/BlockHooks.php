<?php
/**
 * Block registration hooks for Fair Schedule
 *
 * @package FairSchedule
 */

namespace FairSchedule\Hooks;

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
	 * Register time block type
	 *
	 * @return void
	 */
	public function register_blocks() {
		register_block_type( __DIR__ . '/../blocks/time-block' );
	}
}