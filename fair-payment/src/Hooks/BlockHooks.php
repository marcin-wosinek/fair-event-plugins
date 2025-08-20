<?php
/**
 * Block registration hooks for Fair Payment
 *
 * @package FairPayment
 */

namespace FairPayment\Hooks;

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
	 * Register simple payment block type
	 *
	 * @return void
	 */
	public function register_blocks() {
		register_block_type( dirname( dirname( dirname( __FILE__ ) ) ) . '/build/blocks/simple-payment' );
	}
}
