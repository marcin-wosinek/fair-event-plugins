<?php
namespace FairPayment\Hooks;

defined( 'WPINC' ) || die;

class BlockHooks {

	public function __construct() {
		add_action( 'init', array( $this, 'register_blocks' ) );
	}

	public function register_blocks() {
		register_block_type( __DIR__ . '/build/blocks/calendar-button' );
	}
}
